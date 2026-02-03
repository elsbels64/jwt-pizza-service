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

async function createFranchise(franchise = null, adminUser = null) {
  const admin = adminUser || await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: admin.email, password: admin.password });
  const adminAuthToken = adminLoginRes.body.token;

  const usedFranchise = franchise || { name: `Test Franchise ${randomName()}`, admins: [{ email: admin.email }] };
  if (!Array.isArray(usedFranchise.admins)) {
    usedFranchise.admins = usedFranchise.admins ? [usedFranchise.admins] : [];
  }

  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(usedFranchise);

  const created = res.body && (res.body.franchise || res.body.data || res.body);
  return { res, created, usedFranchise, admin, adminAuthToken };
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
  const { res, created, usedFranchise } = await createFranchise();
  expect(res.status).toBe(200);
  expect(created).toMatchObject(usedFranchise);
});

test('delete franchise', async () => {
  const { created } = await createFranchise({ name: `Delete Franchise ${randomName()}` });
  const res = await request(app)
    .delete(`/api/franchise/${created.id}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'franchise deleted' });
});

test('get franchise', async () => {
  const { created } = await createFranchise({ name: `Get Franchise ${randomName()}` });
  const res = await request(app)
    .get('/api/franchise/')
    .set('Authorization', `Bearer ${testUserAuthToken}`); 
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.franchises)).toBe(true);
  const found = res.body.franchises.find((f) => f.id === created.id);
  expect(found).toBeDefined();
  expect(found).toMatchObject({ name: created.name });
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
