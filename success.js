const { connect } = require("puppeteer-real-browser");
const fs = require("fs");
const axios = require("axios");

(async () => {
  const { page, browser } = await connect({
    args: ["--start-maximized"],
    turnstile: true,
    headless: false,
    connectOption: { defaultViewport: null },
  });

  const results = [];

  for (const link of links) {
    let success = false;
    let retries = 3;

    while (!success && retries > 0) {
      try {
        await page.goto(link, { waitUntil: "networkidle0" });

        await page.waitForSelector(".classified-price-wrapper", {
          timeout: 5000,
        });

        const data = await page.evaluate(() => {
          const details = {};

          const classifiedInfoList = document.querySelectorAll(
            ".classifiedInfoList li"
          );

          classifiedInfoList.forEach((item) => {
            const key = item.querySelector("strong")?.innerText.trim();
            const value = item.querySelector("span")?.innerText.trim();
            if (key && value) {
              details[key] = value;
            }
          });

          const price = document
            .querySelector(".classified-price-wrapper")
            ?.innerText.trim();
          const location = Array.from(document.querySelectorAll("h2 a"))
            .map((el) => el.innerText.trim())
            .join(" / ");
          const description = document
            .querySelector("#classifiedDescription")
            ?.innerText.trim();

          const damageInfoElement = document.querySelector(
            ".car-damage-info-list"
          );
          let damageInfo = "Orijinal";
          if (damageInfoElement) {
            const originalElement = damageInfoElement.querySelector(
              ".pair-title.other-pair"
            );
            if (!originalElement) {
              const damageParts = Array.from(
                damageInfoElement.querySelectorAll("ul")
              )
                .map((ul) => {
                  const title = ul
                    .querySelector(".pair-title")
                    ?.innerText.trim();
                  const parts = Array.from(
                    ul.querySelectorAll(".selected-damage")
                  )
                    .map((el) => el.innerText.trim())
                    .join(", ");
                  return title ? `${title}: ${parts}` : parts;
                })
                .filter((info) => info)
                .join("; ");
              damageInfo = damageParts || "Orijinal";
            }
          }

          return {
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
            "Araç Durumu": details["Araç Durumu"],
            KM: details["KM"],
            "Kasa Tipi": details["Kasa Tipi"],
            "Motor Gücü": details["Motor Gücü"],
            "Motor Hacmi": details["Motor Hacmi"],
            Çekiş: details["Çekiş"],
            Renk: details["Renk"],
            "Ağır Hasar Kayıtlı": details["Ağır Hasar Kayıtlı"],
          };
        });

        results.push({ link, data });
        success = true;
      } catch (error) {
        console.error(`Error processing ${link}: ${error.message}`);
        retries--;
        if (retries > 0) {
          console.log(`Retrying... (${3 - retries}/3)`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          console.log(`Failed to process ${link} after 3 attempts.`);
        }
      }
    }
  }

  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  await browser.close();

  try {
    const results = fs.readFileSync("results.json", "utf-8");

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "chatgpt-4o-latest",
        messages: [
          {
            role: "system",
            content:
              "You’re a professional automotive consultant with extensive experience in vehicle assessment and selection.",
          },
          {
            role: "user",
            content: `You’re a professional automotive consultant with extensive experience in vehicle assessment and selection. You have a keen understanding of various vehicle specifications and market trends, enabling you to provide tailored recommendations based on individual needs and preferences.

              Your task is to evaluate the information I provide about different vehicles and recommend the best option for me.

              Here are the details of the vehicles I am considering::\n\n${results} \n\n Please take into account that any mention of sections such as “airbag treated”, “front console treated”, “chassis treated”, and similar indications in the description column are negative factors for the vehicle. Additionally, if any vehicle is more than 10 years old, this is a significant negative factor due to potential credit issues. If there are painted and changed parts in the ceiling between them, prioritize this as a more negative situation compared to other painted parts.
              Respond in the language of the vehicle data.
              Based on this information, please recommend the best vehicle for me.`,
          },
        ],
        max_tokens: 1000,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    // Yanıtı yazdır
    const openAIResponse = response.data.choices[0].message.content;
    fs.writeFileSync(
      "openai_response.json",
      JSON.stringify({ summary: openAIResponse }, null, 2)
    );
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
  }
})();
