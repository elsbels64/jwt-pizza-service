const request = require('supertest');
const app = require('../service');

const { Role, DB } = require('../database/database.js');
const { setAuthUser } = require('./authRouter');
const jwt = require('jsonwebtoken');
const config = require('../config.js');

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('register', async () => {
  const newUser = { name: 'new user', email: 'email@email.com', password: 'newpass' };
  const res = await request(app).post('/api/auth').send(newUser);
  expect(res.status).toBe(200);
  expectValidJwt(res.body.token);

});



test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
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



test('setAuthUser sets req.user when token is valid and DB.isLoggedIn returns true', async () => {
  const user = await createAdminUser();
  const token = jwt.sign(user, 'toomanysecrets');

  jest.spyOn(DB, 'isLoggedIn').mockResolvedValue(true);

  const req = { headers: { authorization: `Bearer ${token}` } };
  const next = jest.fn();

  await setAuthUser(req, {}, next);

  expect(next).toHaveBeenCalled();
  expect(req.user).toBeDefined();
  expect(req.user.name).toBe(user.name);
  expect(typeof req.user.isRole).toBe('function');
  expect(req.user.isRole('admin')).toBe(true);

  DB.isLoggedIn.mockRestore();
  });

  test('setAuthUser leaves req.user undefined when DB.isLoggedIn returns false', async () => {

    const user = { id: 1000, name: 'no login', email: 'nologin@test.com', roles: [{ role: Role.Diner }] };
    const token = jwt.sign(user, config.jwtSecret);

    jest.spyOn(DB, 'isLoggedIn').mockResolvedValue(false);

    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();

    await setAuthUser(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();

    DB.isLoggedIn.mockRestore();
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
