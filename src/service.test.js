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

test('get user franchises', async () => {
  const { created, admin, adminAuthToken } = await createFranchise({ name: `User Franchise ${randomName()}` });
  const res = await request(app)    
    .get(`/api/franchise/${admin.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`); 
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  const found = res.body.find((f) => f.id === created.id);
  expect(found).toBeDefined();
  expect(found).toMatchObject({ name: created.name });
});

test('create store', async () => {
  const { created: franchise, adminAuthToken } = await createFranchise({ name: `Store Franchise ${randomName()}` });
  const storeData = { name: `Test Store ${randomName()}`, address: '123 Test St', phone: '555-1234' };    
  const res = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(storeData); 
  expect(res.status).toBe(200);
  expect(res.body.name).toMatch(storeData.name);  

  const storeId = res.body.id;

  // Cleanup - delete the store
  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${storeId}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'store deleted' });
});


test('delete store unauthorized', async () => {
  const { created: franchise } = await createFranchise({ name: `Unauthorized Store Franchise ${randomName()}` });
  const storeData = { name: `Unauthorized Test Store ${randomName()}`, address: '123 Test St', phone: '555-1234' };    
  const adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const adminAuthToken = adminLoginRes.body.token;  

  const storeRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(storeData); 
  expect(storeRes.status).toBe(200);
  const storeId = storeRes.body.id;   
  const res = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${storeId}`); 
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ message: 'unauthorized' });  
} );


test('delete store non-existent store', async () => {
  const { created: franchise, adminAuthToken } = await createFranchise({ name: `NonExistent Store Franchise ${randomName()}` });
  const res = await request(app)  
    .delete(`/api/franchise/${franchise.id}/store/36`) // assuming 999999 does not exist
    .set('Authorization', `Bearer ${adminAuthToken}`); 
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ message: 'unable to delete a store' });  
} );

test('get menu', async () => {
  const res = await request(app)
    .get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('add menu item unauthorized', async () => {
  const res = await request(app)
    .put('/api/order/menu')
    .send({ menuId: 999, description: 'Unauthorized Item', price: 9.99 });
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ message: 'unauthorized' });
});

test('add menu item', async () => {
  const adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const adminAuthToken = adminLoginRes.body.token;      
  const newItem = { title: `New Test Item ${randomName()}`, description: `Delicious ${randomName()}`, image: 'pizza-test.png', price: 4.99 };
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(newItem);
  expect(res.status).toBe(200);
  const found = res.body.find((item) => item.title === newItem.title);
  expect(found).toBeDefined();
  expect(found).toMatchObject({ title: newItem.title, description: newItem.description, price: newItem.price });
});

test('create order', async () => {
  const orderReq = { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] };
  const res = await request(app)    
    .post('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(orderReq);
  expect(res.status).toBe(200);
  expect(res.body.order).toMatchObject(orderReq);
  expectValidJwt(res.body.jwt);
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
