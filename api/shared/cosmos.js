const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DB_NAME || 'mychordpro';
const containerId = process.env.COSMOS_DB_CONTAINER || 'songs';

let client = null;

function hasCosmosConfig() {
  return Boolean(endpoint && key);
}

function getClient() {
  if (!hasCosmosConfig()) {
    return null;
  }

  if (!client) {
    client = new CosmosClient({ endpoint, key });
  }

  return client;
}

function getContainer(databaseName = databaseId, containerName = containerId) {
  const activeClient = getClient();
  return activeClient
    ? activeClient.database(databaseName).container(containerName)
    : null;
}

module.exports = {
  endpoint,
  key,
  databaseId,
  containerId,
  hasCosmosConfig,
  getClient,
  getContainer
};
