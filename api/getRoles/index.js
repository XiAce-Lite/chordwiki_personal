const { getContainer } = require('../shared/cosmos');

const container = getContainer(
  process.env.COSMOS_DB_NAME || 'ChordWiki',
  process.env.COSMOS_ROLE_CONTAINER || 'userRoles'
);

module.exports = async function (context, req) {
  context.res = { body: { roles: ["admin", "editor"] } };
};

/*
module.exports = async function (context, req) {
  const userId = String(req.body?.userId || '').trim();

  // Cosmos DB から userId で 1 件取得した想定
  let record = null;

  if (userId && container) {
    const querySpec = {
      query: 'SELECT TOP 1 * FROM c WHERE c.userId = @userId',
      parameters: [{ name: '@userId', value: userId }]
    };

    const { resources } = await container.items.query(querySpec).fetchAll();
    record = Array.isArray(resources) ? resources[0] : null;
  }

  const roles = [];

  if (record?.isAdmin === true) {
    roles.push('admin');
  }

  if (record?.isEditor === true) {
    roles.push('editor');
  }

  context.res = {
    headers: { 'Content-Type': 'application/json' },
    body: { roles }
  };
};
*/