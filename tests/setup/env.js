// Loaded into every Jest worker before test files run.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
