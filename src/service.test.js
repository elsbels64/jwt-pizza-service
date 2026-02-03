const request = require('supertest');
const app = require('./service');

const { Role, DB } = require('./database/database.js');
// const { setAuthUser } = require('./routes/authRouter');
// const jwt = require('jsonwebtoken');
// const config = require('./config.js');


const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expect(loginRes.body.token).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);

  const { password, ...user } = { ...testUser, roles: [{ role: 'diner' }] };
  expect(password).toMatch(password);//appeasing the linter will fix this later
  expect(loginRes.body.user).toMatchObject(user);
});

test('register', async () => {
  const newUser = { name: 'new user', email: 'email@email.com', password: 'newpass' };
  const res = await request(app).post('/api/auth').send(newUser);
  expect(res.status).toBe(200);
  expectValidJwt(res.body.token);

});

test('logout', async () => {
  const res = await request(app)
    .delete('/api/auth')  
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'logout successful' });
});

test('missing password: returns 400 with required message', async () => {
    const res = await request(app).post('/api/auth').send({ name: 'no pass', email: 'nop@test.com' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'name, email, and password are required' });
  });


test('create franchise', async () => {
  const adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const adminAuthToken = adminLoginRes.body.token;
  const newFranchise = { name: 'Test Franchise', admins: [{ email: adminUser.email }] };
  newFranchise.name = `Test Franchise ${randomName()}`;
  // Ensure admins is always an array to avoid "not iterable" errors if the body is mutated
  if (!Array.isArray(newFranchise.admins)) {
    newFranchise.admins = newFranchise.admins ? [newFranchise.admins] : [];
  }

  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(newFranchise);

  expect(res.status).toBe(200);
  // Support servers that return the created franchise either at the top-level or nested (e.g., { franchise: {...} } or { data: {...} })
  const created = res.body && (res.body.franchise || res.body.data || res.body);
  expect(created).toMatchObject(newFranchise);
});




function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}
