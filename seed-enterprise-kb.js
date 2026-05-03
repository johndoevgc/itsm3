// One-time script to seed enterprise KB articles into Azure MySQL
// Run via Kudu command API on the server
const mysql = require("mysql2/promise");

async function main() {
  // SECURITY (#4): refuse to run against the production MySQL host unless explicitly opted in.
  const host = process.env.MYSQL_HOST || "vgc-itsm-mysql.mysql.database.azure.com";
  if (/vgc-itsm1-mysql\.mysql\.database\.azure\.com/.test(host) && process.env.ALLOW_PROD_SEED_WRITES !== "true") {
    console.error(`[seed-enterprise-kb] Refusing to run against production MySQL (${host}). Set ALLOW_PROD_SEED_WRITES=true.`);
    process.exit(2);
  }
  const kb = require("./kb-enterprise-articles.json");
  const conn = await mysql.createConnection({
    host,
    user: process.env.MYSQL_USER || "vgcadmin",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "flexibleserverdb",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    ssl: { rejectUnauthorized: true }
  });
  
  let inserted = 0;
  for (const article of kb) {
    try {
      await conn.execute(
        "INSERT INTO itsm_data (collection, id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)",
        ["kb", article.id, JSON.stringify(article)]
      );
      console.log("Inserted:", article.id, "-", article.title.substring(0, 50));
      inserted++;
    } catch (e) {
      console.error("Failed:", article.id, e.message);
    }
  }
  
  console.log(`Done: ${inserted}/${kb.length} articles inserted`);
  await conn.end();
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
