const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;

// 文字列は直書きでも動くが、後で変えたくなるので env 対応も入れておく
const databaseId = process.env.COSMOS_DB_NAME || "ChordWiki";
const containerId = process.env.COSMOS_DB_CONTAINER || "Songs";

// ここが空だと必ず落ちるので、早めにエラー化
if (!endpoint || !key) {
  throw new Error("Missing COSMOS_ENDPOINT or COSMOS_KEY in app settings");
}

const client = new CosmosClient({ endpoint, key });

module.exports = async function (context, req) {
  try {
    const container = client.database(databaseId).container(containerId);

    // 最小：返却項目を絞る（RU/転送量の無駄を減らす）
    // 並び順が欲しければ後で ORDER BY（RU増） or クライアントでソート
    const query = {
      query: "SELECT c.id, c.artist, c.title, c.slug FROM c"
    };

    // @azure/cosmos v4 の query は async iterator
    const { resources } = await container.items.query(query, {
      enableCrossPartitionQuery: true,   // partition key が /artist なので必須（一覧はクロスパーティション）
      maxItemCount: 100                  // 念のため上限（増えたらページング）
    }).fetchAll();

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: resources
    };
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { error: "Internal Server Error", detail: String(error.message || error) }
    };
  }
};