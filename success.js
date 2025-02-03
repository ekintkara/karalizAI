const fs = require("fs");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const initCycleTLS = require('cycletls');
const cheerio = require('cheerio');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

let proxyList = [];
let currentProxyIndex = 0;

const fetchProxyList = async () => {
  try {
    const response = await axios.get('https://proxy.webshare.io/api/v2/proxy/list/download/ygwtymnmgkjpevbqdmwluintlppyxycjelntekib/-/any/username/direct/-/');
    const proxyText = response.data;
    
    // Parse the proxy text into an array of proxy objects
    proxyList = proxyText.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [host, port, username, password] = line.split(':');
        return { host, port: parseInt(port), username, password };
      });
    
    console.log(`Loaded ${proxyList.length} proxies`);
  } catch (error) {
    console.error('Error fetching proxy list:', error.message);
    throw error;
  }
};

const getNextProxy = () => {
  if (proxyList.length === 0) {
    throw new Error('No proxies available');
  }
  const proxy = proxyList[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;
  return proxy;
};

(async () => {
  const [apiKey, llmType, ...links] = process.argv.slice(2);

  console.log("llmType", llmType);
  console.log("links", links);
  console.log("apiKey", apiKey);

  // Fetch proxy list before starting
  await fetchProxyList();

  const cycleTLS = await initCycleTLS();

  const results = [];

  for (const link of links) {
    let success = false;
    let retries = 3;

    while (!success && retries > 0) {
      try {
        const currentProxy = getNextProxy();
        
        const session = await fetch("http://localhost:3000/cf-clearance-scraper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: link,
            mode: "waf-session",
            proxy: {
              host: currentProxy.host,
              port: currentProxy.port,
              username: currentProxy.username,
              password: currentProxy.password
            }
          }),
        })
          .then((res) => res.json())
          .catch((err) => {
            throw new Error(`cf-clearance-scraper error: ${err.message}`);
          });

        if (!session || session.code !== 200) {
          throw new Error(`Session could not be retrieved: ${JSON.stringify(session)}`);
        }

        const response = await cycleTLS(
          link,
          {
            body: "",
            ja3: "772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-27-65037-43-51-45-16-11-13-17513-5-18-65281-0-10-35,25497-29-23-24,0",
            userAgent: session.headers["user-agent"],
            headers: {
              ...session.headers,
              cookie: session.cookies
                .map((c) => `${c.name}=${c.value}`)
                .join("; "),
            },
          },
          "get"
        );

        if (process.send) {
          process.send({
            type: "log",
            data: `Navigated to ${link}`
          });
        }
        console.log("Navigated to", link);

        if (!response || response.status !== 200 || !response.body) {
          throw new Error(`Response error. Status: ${response?.status}`);
        }

        if (!response.body.includes("classified-price-wrapper")) {
          throw new Error("Selector .classified-price-wrapper not found in HTML");
        }

        const $ = cheerio.load(response.body);

        const details = {};
        $(".classifiedInfoList li").each((i, item) => {
          const key = $(item).find("strong").text().trim();
          const value = $(item).find("span").text().trim();
          if (key && value) {
            details[key] = value;
          }
        });

        const price = $(".classified-price-wrapper").text().trim();
        const location = $("h2 a")
          .map((i, el) => $(el).text().trim())
          .get()
          .join(" / ");
        const description = $("#classifiedDescription").text().trim();

        let damageInfo = "Orijinal";
        const damageInfoElement = $(".car-damage-info-list");
        if (damageInfoElement.length) {
          const originalElement = damageInfoElement.find(".pair-title.other-pair");
          if (!originalElement.length) {
            const damageParts = [];
            damageInfoElement.find("ul").each((i, ul) => {
              const title = $(ul).find(".pair-title").text().trim();
              const parts = $(ul)
                .find(".selected-damage")
                .map((j, sel) => $(sel).text().trim())
                .get()
                .join(", ");
              if (title) {
                damageParts.push(`${title}: ${parts}`);
              } else {
                damageParts.push(parts);
              }
            });
            const joined = damageParts.filter((info) => info).join("; ");
            damageInfo = joined || "Orijinal";
          }
        }

        const data = {
          price,
          location,
          description,
          damageInfo,
          "İlan Tarihi": details["İlan Tarihi"],
          Marka: details["Marka"],
          Seri: details["Seri"],
          Model: details["Model"],
          Yıl: details["Yıl"],
          Yakıt: details["Yakıt"],
          Vites: details["Vites"],
          KM: details["KM"],
          "Kasa Tipi": details["Kasa Tipi"],
          "Motor Gücü": details["Motor Gücü"],
          "Motor Hacmi": details["Motor Hacmi"],
          Çekiş: details["Çekiş"],
          Renk: details["Renk"],
          "Ağır Hasar Kayıtlı": details["Ağır Hasar Kayıtlı"],
        };

        results.push({ link, data });
        success = true;
      } catch (error) {
        if (process.send) {
          process.send({
            type: "log",
            data: `Error processing ${link}: ${error.message}`
          });
        }
        console.error(`Error processing ${link}: ${error.message}`);
        retries--;
        if (retries > 0) {
          if (process.send) {
            process.send({
              type: "log",
              data: `Retrying... (${3 - retries}/3)`
            });
          }
          console.log(`Retrying... (${3 - retries}/3)`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          if (process.send) {
            process.send({
              type: "log",
              data: `Failed to process ${link} after 3 attempts.`
            });
          }
          console.log(`Failed to process ${link} after 3 attempts.`);
        }
      }
    }
  }

  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));

  try {
    const results = fs.readFileSync("results.json", "utf-8");

    if (llmType === "gemini-1.5") {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

      const prompt = `Analyze and compare these vehicle details: ${results}. 
      Provide a comprehensive comparison highlighting key differences, 
      strengths, and potential value for money.`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      fs.writeFileSync(
        "openai_response.json",
        JSON.stringify({
          choices: [{ message: { content: response } }],
        })
      );

      if (process.send) {
        process.send({
          type: "log",
          data: "Successfully processed with Gemini 1.5",
        });
      }
    } else {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "chatgpt-4o-latest",
          max_tokens: 300,
          temperature: 0.5,
          messages: [
            {
              role: "system",
              content:
                "You’re a professional automotive consultant with extensive experience in vehicle assessment and selection. " +
                "Provide your recommendations clearly and succinctly. Keep your response as short as possible (under 200 words).",
            },
            {
              role: "user",
              content: `You’re a professional automotive consultant with extensive experience in vehicle assessment and selection. 
                You have a keen understanding of various vehicle specifications and market trends, enabling you to provide tailored 
                recommendations based on individual needs and preferences.
    
                Your task is to evaluate the information I provide about different vehicles and recommend the best option for me.
    
                Here are the details of the vehicles I am considering:\n\n${results}\n\n
                Please take into account that any mention of “airbag treated”, “front console treated”, “chassis treated”, 
                etc. in the description is negative. Also, if any vehicle is more than 10 years old, it’s a significant negative 
                factor. If there are painted or changed parts in the ceiling, consider it more negative than other painted parts.
    
                Respond in the language of the vehicle data, but keep your overall reply concise. Based on this information, please 
                recommend the best vehicle for me in a short summary.`,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      fs.writeFileSync("openai_response.json", JSON.stringify(response.data));
    }
  } catch (error) {
    if (process.send) {
      process.send({
        type: "log",
        data: `Error: ${error.response?.data || error.message}`,
      });
    }
    console.error("Error:", error.response?.data || error.message);
  } finally {
    cycleTLS.exit().catch((err) => {
      console.error("cycleTLS exit error:", err);
    });
  }
})();
