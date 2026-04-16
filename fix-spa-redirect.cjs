const { execSync } = require("child_process");

async function main() {
  const token = execSync(
    "az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv",
    { encoding: "utf8" }
  ).trim();

  // Step 1: Get the app's object ID
  const searchRes = await fetch(
    "https://graph.microsoft.com/v1.0/myOrganization/applications?$filter=appId%20eq%20%27be40e7d3-69a7-4414-90ba-4391d152f70b%27&$select=id,displayName,spa,web",
    { headers: { Authorization: "Bearer " + token } }
  );
  const searchData = await searchRes.json();
  console.log("Search status:", searchRes.status);

  if (searchData.error) {
    console.log("Search error:", searchData.error.message);
    // Try direct approach with known appId
    console.log("\nTrying direct PATCH with appId...");
    const patchRes = await fetch(
      "https://graph.microsoft.com/v1.0/applications(appId='be40e7d3-69a7-4414-90ba-4391d152f70b')",
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          spa: {
            redirectUris: [
              "https://vgcitsm.vgcsg.com",
              "https://vgc-itsm-app.azurewebsites.net",
              "http://localhost:8080",
              "http://localhost:4173",
            ],
          },
        }),
      }
    );
    console.log("PATCH status:", patchRes.status);
    const patchText = await patchRes.text();
    console.log("PATCH response:", patchText || "Success (204 No Content)");
    return;
  }

  if (!searchData.value || !searchData.value[0]) {
    console.log("App not found in search results:", JSON.stringify(searchData));
    return;
  }

  const app = searchData.value[0];
  console.log("Found app:", app.displayName, "Object ID:", app.id);
  console.log("Current SPA URIs:", JSON.stringify(app.spa));
  console.log("Current Web URIs:", JSON.stringify(app.web));

  // Step 2: PATCH the SPA redirect URIs
  const patchRes = await fetch(
    "https://graph.microsoft.com/v1.0/applications/" + app.id,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spa: {
          redirectUris: [
            "https://vgcitsm.vgcsg.com",
            "https://vgc-itsm-app.azurewebsites.net",
            "http://localhost:8080",
            "http://localhost:4173",
          ],
        },
      }),
    }
  );
  console.log("PATCH status:", patchRes.status);
  const patchText = await patchRes.text();
  console.log("PATCH response:", patchText || "Success (204 No Content)");

  // Step 3: Verify
  const verifyRes = await fetch(
    "https://graph.microsoft.com/v1.0/applications/" + app.id + "?$select=spa,web",
    { headers: { Authorization: "Bearer " + token } }
  );
  const verifyData = await verifyRes.json();
  console.log("\nVerification - SPA URIs:", JSON.stringify(verifyData.spa, null, 2));
  console.log("Verification - Web URIs:", JSON.stringify(verifyData.web?.redirectUris));
}

main().catch(console.error);
