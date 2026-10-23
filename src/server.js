require('dotenv').config();
const app = require('./app');
const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Dofol's Freshly Baked Pizza is available at http://localhost:${port}`);
});
