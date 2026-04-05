const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_NAME || "ChordWiki";
const containerId = process.env.COSMOS_DB_CONTAINER || "Songs";

let container = null;
if (endpoint && key) {
  const client = new CosmosClient({ endpoint, key });
  container = client.database(databaseId).container(containerId);
}

function badRequest(context, detail) {
  context.res = { status: 400, body: { error: "BadRequest", detail } };
}

module.exports = async function (context, req) {
  try {
    if (!container) {
      context.res = {
        status: 500,
        body: {
          error: "ServerConfigError",
          detail: "Missing COSMOS_DB_ENDPOINT or COSMOS_DB_KEY"
        }
      };
      return;
    }

    let body = req.body;

    // req.body が文字列で来るケース対応
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        badRequest(context, "Request body must be valid JSON.");
        return;
      }
    }

    if (!body || typeof body !== "object") {
      badRequest(context, "Request body must be JSON.");
      return;
    }

    const { id, title, slug, artist, tags, chordPro, updatedAt } = body;

    if (!id || !title || !slug || !artist || !tags || !chordPro || !updatedAt) {
      badRequest(context, "id, title, slug, artist, tags, chordPro, updatedAt are required.");
      return;
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      badRequest(context, "tags must be a non-empty array.");
      return;
    }

    // tags の中身を軽く正規化/検証
    const tagsNormalized = tags
      .map(t => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean);

    if (tagsNormalized.length === 0) {
      badRequest(context, "tags must contain at least one non-empty string.");
      return;
    }

    // chordPro は文字列必須
    if (typeof chordPro !== "string" || chordPro.trim().length === 0) {
      badRequest(context, "chordPro must be a non-empty string.");
      return;
    }

    const item = { id, title, slug, artist, tags: tagsNormalized, chordPro, updatedAt };

    try {
      const { resource } = await container.items.create(item, { partitionKey: artist });
      context.res = { status: 201, body: resource };
    } catch (e) {
      // 409: id + partitionKey 競合など
      if (e.code === 409) {
        context.res = {
          status: 409,
          body: { error: "Conflict", detail: "Item already exists (id conflict within partition)." }
        };
        return;
      }
      throw e;
    }
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      body: { error: "InternalServerError", detail: String(error.message || error) }
    };
  }
};