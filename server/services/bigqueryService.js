const { BigQuery } = require('@google-cloud/bigquery');

/**
 * Get a BigQuery client with explicit credentials from env var.
 * Reads GOOGLE_APPLICATION_CREDENTIALS_JSON from .env (the entire service account JSON as a string).
 * Falls back to GOOGLE_APPLICATION_CREDENTIALS file path, then default credentials.
 */
function getBigQueryClient(projectId) {
    // Option 1: JSON credentials pasted directly into .env
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        try {
            const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
            console.log('BigQuery: Using credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON env var');
            return new BigQuery({
                projectId: projectId || credentials.project_id,
                credentials: credentials
            });
        } catch (e) {
            console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', e.message);
            throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is set but contains invalid JSON. Check your .env file.');
        }
    }

    // Option 2: File path (standard Google env var)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.log('BigQuery: Using credentials file from GOOGLE_APPLICATION_CREDENTIALS');
        return new BigQuery({ projectId });
    }

    // Option 3: Default credentials (works on GCP, fails on most local Windows setups)
    console.log('BigQuery: Attempting default credentials (may fail on Windows)');
    return new BigQuery({ projectId });
}

// Utility sleep for retries
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchLeads(settings, gender, limit = 100, offset = 0, sourceFilter = null) {
    const { bq_project_id, bq_query_template } = settings;

    if (!bq_project_id || !bq_query_template) {
        throw new Error('BigQuery settings missing');
    }

    let query = bq_query_template;

    // Replace placeholder logic
    // FORCE FIX: If gender is 'All', use 1=1. 
    // Even if gender is passed, check if we should trust it? 
    // No, we trust the frontend 'All'.

    const genderClause = (gender && gender !== 'All')
        ? `gender = '${gender}'`
        : '1=1';

    if (query.includes('...')) {
        query = query.replace('...', genderClause);
    } else {
        if (query.toLowerCase().includes('where')) {
            query += ` AND ${genderClause}`;
        } else {
            query += ` WHERE ${genderClause}`;
        }
    }

    // Source filter
    if (sourceFilter) {
        if (Array.isArray(sourceFilter) && sourceFilter.length > 0) {
            const escapedSources = sourceFilter.map(s => `'${String(s).replace(/'/g, "''")}'`).join(', ');
            if (query.toLowerCase().includes('where')) {
                query += ` AND source IN (${escapedSources})`;
            } else {
                query += ` WHERE source IN (${escapedSources})`;
            }
        } else if (typeof sourceFilter === 'string' && sourceFilter !== 'All') {
            const escaped = String(sourceFilter).replace(/'/g, "''");
            if (query.toLowerCase().includes('where')) {
                query += ` AND source = '${escaped}'`;
            } else {
                query += ` WHERE source = '${escaped}'`;
            }
        }
    }

    // Randomize row order so each fetch gets fresh data from across the table
    if (!query.toUpperCase().includes('ORDER BY')) {
        query += ' ORDER BY RAND()';
    }

    // Safe limit and offset enforcement
    // We force integer conversion to sanitize inputs (no injection)
    const limitParams = ` LIMIT ${parseInt(limit) || 100} OFFSET ${parseInt(offset || 0)}`;

    // Append limit/offset logic
    // We check for LIMIT via simple string match first
    if (!query.toUpperCase().includes('LIMIT')) {
        query += limitParams;
    } else {
        // More robust replacement: remove any LIMIT...OFFSET... or just LIMIT... at the end
        // Handles trailing whitespace, semicolons (simple), etc.
        query = query.replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?[\s;]*$/i, limitParams);
    }

    console.log('--- BigQuery Debug Info ---');
    console.log('Project ID:', bq_project_id);
    console.log('Executing Query:', query);
    require('fs').appendFileSync('bq_debug.log', `[${new Date().toISOString()}] Executing Query: ${query}\n`);
    console.log('---------------------------');

    const bigquery = getBigQueryClient(bq_project_id);

    const options = {
        query: query,
        location: 'US',
        timeoutMs: 30000, // 30s timeout
    };

    // Retry logic
    const MAX_RETRIES = 2;
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`BigQuery Attempt ${attempt}/${MAX_RETRIES}...`);
            const [rows] = await Promise.race([
                bigquery.query(options),
                new Promise((_, reject) => setTimeout(() => reject(new Error('BigQuery query timed out after 30s')), 30000))
            ]);
            console.log(`BigQuery Success! Returned ${rows.length} rows.`);
            return rows;

        } catch (e) {
            console.error(`BigQuery Attempt ${attempt} Failed:`, e.message);
            lastError = e;

            // Categorize error for logging
            let errorType = 'unknown';
            if (e.message.includes('timeout') || e.message.includes('timed out')) errorType = 'timeout';
            else if (e.message.includes('credentials') || e.message.includes('auth')) errorType = 'credentials';
            else if (e.message.includes('denied') || e.message.includes('permission')) errorType = 'permission';
            else if (e.message.includes('Syntax error')) errorType = 'sql_error';

            // Enhance error object
            e.type = errorType;
            e.query = query;

            if (attempt < MAX_RETRIES) {
                console.log('Retrying in 2s...');
                await sleep(2000);
            }
        }
    }

    // If we get here, all retries failed
    throw lastError;
}

module.exports = { fetchLeads };
