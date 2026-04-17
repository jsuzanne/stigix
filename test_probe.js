const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
async function test() {
    try {
        const {stdout, stderr} = await execPromise("dig +short +time=3 google.com @8.8.8.8");
        console.log("DNS SUCCESS:", stdout.trim());
    } catch(e) {
        console.error("DNS ERROR:", e);
    }
}
test();
