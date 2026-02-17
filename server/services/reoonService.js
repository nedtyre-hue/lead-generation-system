const axios = require('axios');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../reoon_debug.log');

async function verifyEmail(email, apiKey) {
    if (!apiKey) return { status: 'unknown' };

    try {
        // Using Reoon Email Verifier API
        // Mode set to 'power' for maximum accuracy (same credit cost)
        const start = Date.now();
        const response = await axios.get('https://emailverifier.reoon.com/api/v1/verify', {
            params: {
                email: email,
                key: apiKey,
                mode: 'power'
            },
            timeout: 30000 // 30s timeout
        });
        const duration = Date.now() - start;

        // Log the response for debugging
        const logEntry = `[${new Date().toISOString()}] ${email}: Status=${response.data.status}, Duration=${duration}ms\n`;
        fs.appendFileSync(logFile, logEntry);

        return response.data;
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Reoon verification failed for ${email}:`, errorMsg);

        const logEntry = `[${new Date().toISOString()}] ${email}: ERROR=${errorMsg}\n`;
        fs.appendFileSync(logFile, logEntry);

        return { status: 'error', error: error.message };
    }
}

module.exports = { verifyEmail };
