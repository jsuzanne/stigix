const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

async function run() {
    const p1 = execPromise("dig +short +time=3 google.com @8.8.8.8");
    const p2 = execPromise("dig +short +time=3 google.com @1.1.1.1");
    try {
        const [r1, r2] = await Promise.all([p1, p2]);
        console.log("R1", r1.stdout.trim());
        console.log("R2", r2.stdout.trim());
    } catch(e) {
        console.error("FAIL", e);
    }
}
run();
