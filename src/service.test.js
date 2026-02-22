const request = require('supertest');
const app = require('./service');

const { Role, DB } = require('./database/database.js');
// const { setAuthUser } = require('./routes/authRouter');
// const jwt = require('jsonwebtoken');
// const config = require('./config.js');


const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;
const createdUsers = [];
const createdFranchises = [];
const createdMenuItems = [];
const createdOrders = [];

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  if (user && user.id) createdUsers.push(user.id);

  // Actually log them in so the token gets stored in the auth table
  const loginRes = await request(app).put('/api/auth').send({ email: user.email, password: 'toomanysecrets' });
  return { ...loginRes.body.user, password: 'toomanysecrets' };
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
  if (created && created.id) createdFranchises.push(created.id);
  return { res, created, usedFranchise, admin, adminAuthToken };
}

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  if (registerRes.body && registerRes.body.user && registerRes.body.user.id) createdUsers.push(registerRes.body.user.id);
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
  if (res.body && res.body.user && res.body.user.id) createdUsers.push(res.body.user.id);

});

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

test('list users', async () => {
  const adminUser = await createAdminUser();
  //console.log('adminUser:', adminUser);

  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
 // console.log('login response:', adminLoginRes.status, adminLoginRes.body);

  const adminAuthToken = adminLoginRes.body.token;
 // console.log('token:', adminAuthToken);

  const res = await request(app)
    .get('/api/user/')
    .set('Authorization', `Bearer ${adminAuthToken}`);

  //console.log(res.status, res.body);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('list users pagination', async () => {
  const adminUser = await createAdminUser();
 const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const adminAuthToken = adminLoginRes.body.token;

  const res = await request(app)
    .get('/api/user/?page=1&limit=2')
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBeLessThanOrEqual(2);
  //console.log('Page 1 response:', res.status, res.body);
  const res2 = await request(app)
    .get('/api/user/?page=2&limit=2')
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(res2.status).toBe(200);
  expect(Array.isArray(res2.body)).toBe(true);
  expect(res2.body.length).toBeLessThanOrEqual(2);
  //console.log('Page 2 response:', res2.status, res2.body);
  if (res.body.length > 0 && res2.body.length > 0) {
    expect(res.body[0].id).not.toBe(res2.body[0].id);
  }
});

test('list users name filter', async () => {
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const adminAuthToken = adminLoginRes.body.token;

  // wildcard should return results
  const res = await request(app)
    .get('/api/user/?name=*')
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body.length).toBeGreaterThan(0);

  // nonexistent name should return empty
  const res2 = await request(app)
    .get('/api/user/?name=nonexistentxyz')
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(res2.status).toBe(200);
  expect(res2.body.length).toBe(0);
});

async function registerUser(service) {
  const testUser = {
    name: 'pizza diner',
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const registerRes = await service.post('/api/auth').send(testUser);
  registerRes.body.user.password = testUser.password;

  return [registerRes.body.user, registerRes.body.token];
}


test('logout', async () => {
  const newUser = { name: 'new user', email: 'email@email.com', password: 'newpass' };
  let res = await request(app).post('/api/auth').send(newUser);
  expect(res.status).toBe(200);
  expectValidJwt(res.body.token);
  res = await request(app)
    .delete('/api/auth')  
    .set('Authorization', `Bearer ${res.body.token}`);
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

test('create franchise unauthorized', async () => {
  const res = await request(app)
    .post('/api/franchise') 
    .set('Authorization', `Bearer ${testUserAuthToken}`)  
    .send({ name: `Unauthorized Franchise ${randomName()}` });
  expect(res.status).toBe(403);
});

test('delete franchise', async () => {
  const { created } = await createFranchise({ name: `Delete Franchise ${randomName()}` });
  const res = await request(app)
    .delete(`/api/franchise/${created.id}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'franchise deleted' });
});

// test('get franchise', async () => {
//   const { created } = await createFranchise({ name: `Get Franchise ${randomName()}` });
//   const res = await request(app)
//     .get('/api/franchise/')
//     .set('Authorization', `Bearer ${testUserAuthToken}`); 
//   expect(res.status).toBe(200);
//   expect(Array.isArray(res.body.franchises)).toBe(true);
//   const found = res.body.franchises.find((f) => f.id === created.id);
//   expect(found).toBeDefined();
//   expect(found).toMatchObject({ name: created.name });
// }); 

// test('get user franchises', async () => {
//   const { created, admin, adminAuthToken } = await createFranchise({ name: `User Franchise ${randomName()}` });
//   const res = await request(app)    
//     .get(`/api/franchise/${admin.id}`)
//     .set('Authorization', `Bearer ${adminAuthToken}`); 
//   expect(res.status).toBe(200);
//   expect(Array.isArray(res.body)).toBe(true);
//   const found = res.body.find((f) => f.id === created.id);
//   expect(found).toBeDefined();
//   expect(found).toMatchObject({ name: created.name });
// });

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

test('create store unauthorized', async () => {
  const { created: franchise } = await createFranchise({ name: `Unauthorized Store Franchise ${randomName()}` });
  const storeData = { name: `Unauthorized Test Store ${randomName()}`, address: '123 Test St', phone: '555-1234' };   
  const res = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .send(storeData); 
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ message: 'unauthorized' });  
} );  

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
  if (found && found.id) createdMenuItems.push(found.id);
});

test('create order', async () => {
  // create franchise + store
  const { created: franchise, adminAuthToken } = await createFranchise({ name: `Store Franchise ${randomName()}` });
  const storeRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ franchiseId: franchise.id, name: `Store ${randomName()}` });
  const store = storeRes.body;

  // create a menu item
  const adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const adminToken = adminLoginRes.body.token;
  const newItem = { title: `New Test Item ${randomName()}`, description: `Delicious ${randomName()}`, image: 'pizza-test.png', price: 0.05 };
  const menuRes = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(newItem);
  const found = Array.isArray(menuRes.body) ? menuRes.body.find((i) => i.title === newItem.title) : undefined;
  const menuId = found && found.id;
  if (menuId) createdMenuItems.push(menuId);

  // place the order using created IDs
  const orderReq = { franchiseId: franchise.id, storeId: store.id, items: [{ menuId, description: found ? found.description : newItem.description, price: found ? found.price : newItem.price }] };
  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(orderReq);

  expect(res.status).toBe(200);
  expect(res.body.order).toMatchObject(orderReq);
  expectValidJwt(res.body.jwt);
  if (res.body && res.body.order && res.body.order.id) createdOrders.push(res.body.order.id);
});

afterAll(async () => {
  // cleanup orders
  if (createdOrders.length) {
    try {
      const conn = await DB.getConnection();
      try {
        await conn.execute(`DELETE FROM orderItem WHERE orderId IN (${createdOrders.join(',')})`);
        await conn.execute(`DELETE FROM dinerOrder WHERE id IN (${createdOrders.join(',')})`);
      } finally {
        conn.end();
      }
    } catch (err) { void err; }
  }

  // cleanup menu items
  if (createdMenuItems.length) {
    try {
      const conn = await DB.getConnection();
      try {
        await conn.execute(`DELETE FROM orderItem WHERE menuId IN (${createdMenuItems.join(',')})`);
        await conn.execute(`DELETE FROM menu WHERE id IN (${createdMenuItems.join(',')})`);
      } finally {
        conn.end();
      }
    } catch (err) { void err; }
  }

  // cleanup franchises
  for (const id of createdFranchises) {
    try {
      if (id) await DB.deleteFranchise(id);
    } catch (err) { void err; }
  }

  // cleanup users
  for (const id of createdUsers) {
    try {
      if (id) await DB.deleteUser(id);
    } catch (err) { void err; }
  }
});

test('get orders', async () => {
  const res = await request(app)    
    .get('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`); 
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('dinerId');
  expect(res.body).toHaveProperty('orders');
  expect(Array.isArray(res.body.orders)).toBe(true);
} );

test('get orders unauthorized', async () => {
  const res = await request(app)    
    .get('/api/order'); 
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ message: 'unauthorized' });
} );

test('create order unauthorized', async () => {
  const orderReq = { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] };
  const res = await request(app)
    .post('/api/order')
    .send(orderReq);
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ message: 'unauthorized' });
} );

test('delete user unauthorized', async () => {
  const res = await request(app)
    .delete('/api/user/9999') // assuming 9999 is not the test user's ID  
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ message: 'unauthorized' });
} );  

test('get user unauthorized', async () => {
  const res = await request(app)
    .get('/api/user/me'); 
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ message: 'unauthorized' });
} );

test('get user', async () => {
  const res = await request(app)
    .get('/api/user/me')  

    .set('Authorization', `Bearer ${testUserAuthToken}`); 
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('id');  
  expect(res.body).toHaveProperty('name');  
  expect(res.body).toHaveProperty('email');  
  expect(res.body).toHaveProperty('roles');  
} );  

test('delete user', async () => {
  const newUser = { name: 'delete me', email: `deleteme${randomName()}@test.com`, password: 'deletepass' };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  expect(registerRes.status).toBe(200);
  const authToken = registerRes.body.token;
  const userId = registerRes.body.user.id;

  const logoutRes = await request(app)
    .delete('/api/auth')
    .set('Authorization', `Bearer ${authToken}`);
  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body).toEqual({ message: 'logout successful' });

  const adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const adminAuthToken = adminLoginRes.body.token;
  const res = await request(app)
    .delete(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'user deleted' });
} );  

test('list users unauthorized', async () => {
  const res = await request(app)
    .get('/api/user/')    
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ message: 'unauthorized' });
} );

test('list users', async () => {
  const adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const adminAuthToken = adminLoginRes.body.token;

  const res = await request(app)
    .get('/api/user/')
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('update user', async () => {
  const newUser = { name: 'update me', email: `updateme${randomName()}@test.com`, password: 'updatepass' };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  expect(registerRes.status).toBe(200);
  const authToken = registerRes.body.token;
  const userId = registerRes.body.user.id;    
  const updatedInfo = { name: 'updated name', email: `updated${randomName()}@test.com`, password: 'newpass' };  
  const res = await request(app)
    .put(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${authToken}`)
    .send(updatedInfo); 
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ id: userId, name: updatedInfo.name, email: updatedInfo.email });
  expectValidJwt(res.body.token); 
} );  

test('update user unauthorized', async () => {
  const res = await request(app)
    .put('/api/user/9999') // assuming 9999 is not the test user's ID  
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: 'hacker', email: 'email.emil.com', password: 'hackpass' });
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ message: 'unauthorized' });
} );


function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}
