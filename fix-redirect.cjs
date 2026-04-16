const { execSync } = require("child_process");

async function main() {
  // Get token for the correct tenant
  const token = execSync(
    'az account get-access-token --tenant 13756b13-6db9-4266-9737-baf100cf340c --resource https://graph.microsoft.com --query accessToken -o tsv',
    { encoding: "utf8" }
  ).trim();
  console.log("Token obtained, length:", token.length);

  // Find the app by appId (using $filter, no parentheses)
  const searchUrl =
    "https://graph.microsoft.com/v1.0/applications?" +
    new URLSearchParams({
      $filter: "appId eq 'be40e7d3-69a7-4414-90ba-4391d152f70b'",
      $select: "id,displayName,spa",
    });

  const listRes = await fetch(searchUrl, {
    headers: { Authorization: "Bearer " + token },
  });
  const listData = await listRes.json();
  console.log("Search result:", JSON.stringify(listData, null, 2));

  if (!listData.value || !listData.value[0]) {
    console.log("App not found via filter. Trying direct appId lookup...");
    // Try direct lookup with appId
    const directRes = await fetch(
      "https://graph.microsoft.com/v1.0/applicationTemplates?$filter=appId eq 'be40e7d3-69a7-4414-90ba-4391d152f70b'",
      { headers: { Authorization: "Bearer " + token } }
    );
    console.log("Direct lookup status:", directRes.status);
    const directData = await directRes.text();
    console.log("Direct lookup:", directData);
    
    // Try service principals
    const spRes = await fetch(
      "https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq 'be40e7d3-69a7-4414-90ba-4391d152f70b'&$select=id,appId,displayName",
      { headers: { Authorization: "Bearer " + token } }
    );
    const spData = await spRes.json();
    console.log("Service principal:", JSON.stringify(spData, null, 2));
    
    // Try myOrganization scope
    const myOrgRes = await fetch(
      "https://graph.microsoft.com/v1.0/myOrganization/applications?$filter=appId eq 'be40e7d3-69a7-4414-90ba-4391d152f70b'&$select=id,displayName,spa",
      { headers: { Authorization: "Bearer " + token } }
    );
    console.log("MyOrg status:", myOrgRes.status);
    const myOrgData = await myOrgRes.json();
    console.log("MyOrg result:", JSON.stringify(myOrgData, null, 2));
    return;
  }

  const objId = listData.value[0].id;
  console.log("Object ID:", objId);
  console.log("Current SPA:", JSON.stringify(listData.value[0].spa));

  // PATCH with new redirect URIs
  const patchRes = await fetch(
    "https://graph.microsoft.com/v1.0/applications/" + objId,
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
  if (patchText) console.log("Response:", patchText);
  else console.log("Success! Redirect URIs updated.");
}

main().catch(console.error);
