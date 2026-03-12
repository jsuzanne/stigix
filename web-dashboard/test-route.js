import { pathToRegexp } from 'path-to-regexp';

try {
  pathToRegexp('/api/target/proxy/:path(.*)');
  console.log('Success for /:path(.*)');
} catch (e) {
  console.log('Error 1:', e.message);
}

try {
  pathToRegexp('/api/target/proxy/{*path}');
  console.log('Success for /{path}');
} catch (e) {
  console.log('Error 3:', e.message);
}

try {
  pathToRegexp('/api/target/proxy/*');
  console.log('Success for /*');
} catch (e) {
  console.log('Error 2:', e.message);
}
