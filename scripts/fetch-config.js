const fs = require("fs");
const dotenv = require("dotenv");

const configEndpoint = process.env["CONFIG_HOST"];
const configServiceName = process.env["CONFIG_SERVICE_NAME"];
const region = process.env["REGION"];
const appEnv = process.env["APP_ENV"];

function writeConfigurations(configurations) {
  let envVal = "";

  for (const key in configurations) {
    envVal += `${key}=${configurations[key]}\n`;
  }

  try {
    console.log("Writing the fetched configurations to .env file...");
    fs.writeFileSync(".env", envVal);
    console.log("Successfully written the configs to .env file");
  } catch (error) {
    console.error("Error writing the configurations to .env:", error.message);
  }
}

async function fetchConfigurations() {
  if (!configEndpoint) {
    console.log(
      "CONFIG_HOST is not set. Skipping config fetch, using existing environment variables."
    );
    return;
  }

  try {
    const response = await fetch(configEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        env: appEnv,
        region: region,
        serviceName: configServiceName,
      }),
    });
    if (!response.ok) {
      console.error(
        "Failed to fetch configurations, StatusCode:",
        response.status
      );
      return;
    }

    const data = await response.json();
    console.log("config: ", data);
    const configurations = data.payload.configMap;
    writeConfigurations(configurations);
  } catch (error) {
    console.error("Error fetching configurations:", error.message);
    console.log("Continuing with existing environment variables.");
  }
}

async function start() {
  await fetchConfigurations();

  // Load .env into process.env
  if (fs.existsSync(".env")) {
    dotenv.config({ override: true });
    console.log("Loaded .env into process.env");
    console.log("Configurations written to .env file: ", process.env.NETOMI_BASE_URL);

  }

  // Start the server
  require("../server.js");
}

start();
