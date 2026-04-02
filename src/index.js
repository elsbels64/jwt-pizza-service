const app = require('./service.js');

const port = process.argv[2] || 3000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});
