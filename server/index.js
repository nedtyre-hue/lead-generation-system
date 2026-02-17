const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const bigqueryService = require('./services/bigqueryService');
const reoonService = require('./services/reoonService');
const manyreachService = require('./services/manyreachService');
const genderDetection = require('gender-detection');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Serve React frontend build (production)
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    console.log(`[STATIC] Serving React build from ${clientDistPath}`);
}

app.get('/', (req, res) => {
    const indexPath = path.join(clientDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('Lead App Server Running — frontend not built yet. Run: cd client && npm run build');
    }
});

// Test DB connection
app.get('/api/health', async (req, res) => {
    try {
        const count = await prisma.lead.count();
        res.json({ status: 'ok', leadCount: count });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ─── SETTINGS ───────────────────────────────────────────────────────────
const SETTINGS_KEYS = [
    'bq_project_id', 'bq_dataset', 'bq_table', 'bq_query_template', 'enabled_sources',
    'reoon_api_key', 'reoon_statuses', // JSON string of array
    'manyreach_api_key', 'manyreach_list_id',
    'manyreach_batch_size', 'manyreach_batch_delay', 'manyreach_retry_delay'
];

// Get Settings
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await prisma.settings.findMany();
        const settingsMap = settings.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {});
        res.json(settingsMap);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Settings
app.post('/api/settings', async (req, res) => {
    const updates = req.body;
    try {
        const transactions = Object.entries(updates).map(([key, value]) => {
            const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            return prisma.settings.upsert({
                where: { key },
                update: { value: strValue },
                create: { key, value: strValue },
            });
        });
        await prisma.$transaction(transactions);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test BigQuery Connection
app.post('/api/settings/test-bigquery', async (req, res) => {
    try {
        const config = req.body;
        if (!config.bq_project_id) throw new Error('Project ID missing');
        if (!config.bq_query_template) throw new Error('Query template missing');

        // Build a clean base query (just SELECT...FROM, no WHERE/ORDER/LIMIT)
        let testQuery = config.bq_query_template;
        // Strip trailing semicolons, LIMIT, OFFSET, ORDER BY, WHERE clauses
        testQuery = testQuery.replace(/;[\s]*$/g, '');
        testQuery = testQuery.replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?/gi, '');
        testQuery = testQuery.replace(/\s+ORDER\s+BY\s+.+$/gi, '');
        // Leave WHERE intact if user has one — fetchLeads will append AND

        console.log('Testing BigQuery with query:', testQuery);

        const rows = await bigqueryService.fetchLeads({
            bq_project_id: config.bq_project_id,
            bq_query_template: testQuery
        }, 'All', 5, 0);

        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        res.json({
            success: true,
            message: `BigQuery connection OK! Fetched ${rows.length} rows. Columns: ${columns.join(', ')}`,
            sample: rows.slice(0, 2)
        });

    } catch (error) {
        console.error('BigQuery Test Failed:', error);
        // Categorize error
        let type = 'unknown';
        const msg = error.message || '';
        if (msg.includes('Not found')) type = 'not_found';
        else if (msg.includes('Access Denied') || msg.includes('permission')) type = 'permission';
        else if (msg.includes('Syntax error')) type = 'sql_error';
        else if (msg.includes('timeout') || msg.includes('DEADLINE')) type = 'timeout';

        res.status(500).json({
            success: false,
            error: msg,
            type
        });
    }
});

// ─── HELPER: Load config from Settings table ─────────────────────────────
async function loadConfig() {
    const settings = await prisma.settings.findMany();
    return settings.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
    }, {});
}

// ─── HELPER: Auto-provision ManyReach List ID ────────────────────────────
// If manyreach_list_id isn't in Settings yet, create a "Lead App Imports" list
// via the API and store the returned ID. This means the user never needs to
// manually find or enter a list ID.
// Bulletproof list ID resolution
async function ensureListId(apiKey) {
    // 1. Validate stored setting
    const existing = await prisma.settings.findFirst({ where: { key: 'manyreach_list_id' } });

    // Strict validation of the stored value
    if (existing?.value && existing.value !== 'undefined' && existing.value !== '[object Object]' && !existing.value.includes('object')) {
        console.log(`Using cached ManyReach List ID: ${existing.value}`);
        return existing.value;
    }

    console.log('Resolving ManyReach List ID (stored value invalid or missing)...');

    // 2. Clear bad setting if present
    await prisma.settings.deleteMany({ where: { key: 'manyreach_list_id' } });

    // 3. Find existing list
    const lists = await manyreachService.getLists(apiKey);
    let match = lists.find(l => l.title === 'Lead App Imports' || l.title === 'Lead App Imports (Auto)');

    // 4. Create if missing
    if (!match) {
        console.log('Creating new ManyReach list "Lead App Imports"...');
        match = await manyreachService.createList('Lead App Imports', apiKey);
    }

    // 5. Extract ID (prioritize .listId per V2 API)
    const listId = String(match.listId || match.id || match.data?.id || match.data?.listId);

    if (!listId || listId === 'undefined' || listId === '[object Object]') {
        throw new Error(`Failed to resolve List ID. Response keys: ${Object.keys(match || {})}`);
    }

    // 6. Save valid ID
    await prisma.settings.create({
        data: { key: 'manyreach_list_id', value: listId }
    });

    console.log(`Resolved and saved ManyReach List ID: ${listId}`);
    return listId;
}

// ─── PHASE 1: CREATE CAMPAIGN & GENERATE LEADS ──────────────────────────
// ─── PHASE 1: CREATE CAMPAIGN & GENERATE LEADS (ADAPTIVE) ────────────────
app.post('/api/campaigns/create', async (req, res) => {
    const { campaignName, gender, source } = req.body;

    if (!campaignName) {
        return res.status(400).json({ error: 'campaignName is required' });
    }

    try {
        const config = await loadConfig();

        // Validate essential settings (Reoon NOT required for Quick Generate)
        const missing = [];
        if (!config.bq_project_id) missing.push('bq_project_id');

        if (missing.length > 0) {
            return res.status(400).json({
                error: `Missing configuration: ${missing.join(', ')}`,
                details: missing
            });
        }
        const requestedLimit = parseInt(req.body.limit) || 100;
        const stopOnLimitReached = req.body.stopOnLimitReached !== false; // Default true
        const oversampleFactor = parseFloat(config.oversample_factor || '5.0');
        console.log(`[Quick Generate] Reoon DISABLED — saving leads as unverified.`);

        // Source filter
        const enabledSources = JSON.parse(config.enabled_sources || '[]');
        let sourceFilter = null;
        if (source && source !== 'All') {
            sourceFilter = source;
        } else if (enabledSources.length > 0) {
            sourceFilter = enabledSources;
        }

        const cleanLeads = [];
        let totalFetched = 0;
        let totalCandidatesAfterLocalFilter = 0;
        let candidatesChecked = 0;
        let duplicatesSkipped = 0;

        let currentOffset = 0;
        let exhausted = false;

        // Safety cap: Check at most requested * factor * 5 candidates
        const maxCandidatesCheck = requestedLimit * oversampleFactor * 5;

        // Base query — fetchLeads handles WHERE/AND/LIMIT/OFFSET/ORDER BY
        const baseQuery = config.bq_query_template;

        // 2. Adaptive Fetch Loop
        // Condition: Continue if we haven't met limit (OR if we are ignoring limit) AND we aren't exhausted/capped
        while ((!stopOnLimitReached || cleanLeads.length < requestedLimit)
            && !exhausted
            && candidatesChecked < maxCandidatesCheck) {

            // Calculate dynamic fetch size — no Reoon waste, so lower multiplier
            const remaining = requestedLimit - cleanLeads.length;
            const fetchSize = Math.min(Math.max(remaining * 2, 50), 500);

            require('fs').appendFileSync('bq_debug.log', `[${new Date().toISOString()}] QuickGen Loop: Clean=${cleanLeads.length}, Goal=${requestedLimit}, FetchSize=${fetchSize}, Offset=${currentOffset}\n`);

            try {
                // Fetch batch from BigQuery
                let candidates = await bigqueryService.fetchLeads(
                    { bq_project_id: config.bq_project_id, bq_query_template: baseQuery },
                    'All', // No gender filter in SQL — handled below
                    fetchSize,
                    currentOffset,
                    sourceFilter
                );

                totalFetched += candidates.length;
                currentOffset += fetchSize;
                candidatesChecked += candidates.length;

                if (candidates.length === 0) {
                    exhausted = true;
                    break;
                }

                // 2a. Local Filter: Gender
                if (gender && gender !== 'All') {
                    const genderDetection = require('gender-detection');
                    candidates = candidates.filter(l => {
                        const firstName = l.first_name || l.firstName || '';
                        if (!firstName) return false;
                        return genderDetection.detect(firstName) === gender.toLowerCase();
                    });
                }

                // 2b. Local Filter: Basic Sanity & Normalization
                candidates = candidates.map(l => {
                    let email = l.email;
                    if (email && typeof email === 'string' && email.includes(',')) {
                        email = email.split(',')[0].trim();
                    }
                    return { ...l, email };
                }).filter(l => l.email && l.email.includes('@'));

                totalCandidatesAfterLocalFilter += candidates.length;

                // 2c. Dedupe within batch
                const seenInBatch = new Set();
                const uniqueBatch = [];
                for (const c of candidates) {
                    const norm = c.email.toLowerCase().trim();
                    if (!seenInBatch.has(norm)) {
                        seenInBatch.add(norm);
                        uniqueBatch.push({ ...c, email: norm });
                    }
                }

                if (uniqueBatch.length > 0) {
                    // Check DB for existing
                    const existingRecords = await prisma.lead.findMany({
                        where: { email: { in: uniqueBatch.map(c => c.email) } },
                        select: { email: true }
                    });
                    const existingEmails = new Set(existingRecords.map(r => r.email.toLowerCase()));

                    // Also check suppression list
                    const suppressedRecords = await prisma.suppressionEmail.findMany({
                        where: { email: { in: uniqueBatch.map(c => c.email) } },
                        select: { email: true }
                    });
                    const suppressedEmails = new Set(suppressedRecords.map(r => r.email.toLowerCase()));

                    const freshCandidates = uniqueBatch.filter(c => {
                        const e = c.email.toLowerCase();
                        if (existingEmails.has(e) || suppressedEmails.has(e)) {
                            duplicatesSkipped++;
                            return false;
                        }
                        return true;
                    });

                    // NO Reoon — save directly as unverified
                    for (const lead of freshCandidates) {
                        if (stopOnLimitReached && cleanLeads.length >= requestedLimit) break;

                        cleanLeads.push({
                            email: lead.email,
                            firstName: lead.firstName || lead.first_name || '',
                            lastName: lead.lastName || lead.last_name || '',
                            gender: lead.gender || gender || '',
                            company: lead.company_name || lead.company || '',
                            source: lead.source || '',
                            sourceDetail: lead.source_detail || '',
                            jobTitle: lead.job_title || '',
                            industry: lead.industry || '',
                            location: lead.location || '',
                            companyDomain: lead.company_domain || '',
                            linkedinUrl: lead.linkedin_url || '',
                            sourceCampaignTag: campaignName,
                            verifiedStatus: 'unverified',
                            verifiedAt: null,
                            pushedToManyReach: false
                        });
                    }
                } else {
                    console.log('Batch contained 0 valid format candidates.');
                }

                console.log(`[Quick Generate] Progress: ${cleanLeads.length}/${requestedLimit} leads saved (unverified).`);

            } catch (err) {
                console.error('Error in fetch loop:', err.message);
                if (cleanLeads.length === 0) throw err; // Fail only if we have 0 leads
                exhausted = true;
                break;
            }
        } // End While

        // 4. Save to DB
        if (cleanLeads.length > 0) {
            try {
                console.log(`Persisting ${cleanLeads.length} unverified leads to DB...`);
                await prisma.lead.createMany({ data: cleanLeads });
            } catch (err) {
                console.error('DB Save Failed:', err.message);
                return res.status(502).json({
                    error: 'Database Save Failed',
                    details: 'Leads were fetched but failed to save to database.',
                    message: err.message
                });
            }
        }

        res.json({
            success: true,
            listName: campaignName,
            requested: requestedLimit,
            stats: {
                totalFetched,
                totalCandidatesAfterLocalFilter,
                totalSentToReoon: 0,
                totalVerifiedClean: cleanLeads.length,
                duplicatesSkipped,
                candidatesChecked,
                statusBreakdown: { unverified: cleanLeads.length }
            },
            cleanLeads: cleanLeads.length,
            exhausted,
            reoonDisabled: true,
            message: cleanLeads.length < requestedLimit ?
                `Generated ${cleanLeads.length} unverified leads (Target ${requestedLimit}). Source exhausted after checking ${candidatesChecked} candidates.` :
                `Successfully generated ${cleanLeads.length} unverified leads (Reoon disabled).`
        });

    } catch (error) {
        console.error('Error in campaign creation flow:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── TOP INDUSTRIES (from BigQuery master_leads) ─────────────────────────
app.get('/api/industries/top', async (req, res) => {
    try {
        const config = await loadConfig();
        if (!config.bq_project_id) {
            return res.status(400).json({ error: 'bq_project_id not configured' });
        }

        const { BigQuery } = require('@google-cloud/bigquery');
        let bigquery;
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
            const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
            bigquery = new BigQuery({ projectId: config.bq_project_id, credentials });
        } else {
            bigquery = new BigQuery({ projectId: config.bq_project_id });
        }

        const query = `
            SELECT
                LOWER(TRIM(industry)) AS industry,
                COUNT(*) AS lead_count
            FROM \`${config.bq_project_id}.leadraw.master_leads\`
            WHERE industry IS NOT NULL AND industry != ''
            GROUP BY industry
            ORDER BY lead_count DESC
            LIMIT 200
        `;

        console.log('[Top Industries] Running BigQuery query...');
        const [queryRows] = await bigquery.query({ query, location: 'US' });
        console.log(`[Top Industries] Found ${queryRows.length} distinct industries.`);

        res.json({ industries: queryRows.map(r => ({ industry: r.industry, rows: parseInt(r.lead_count) })) });
    } catch (error) {
        console.error('Top Industries error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ─── GENERATE LEAD LIST (SSE STREAMING PROGRESS) ────────────────────────
app.get('/api/lists/generate', async (req, res) => {
    const { listName, gender, target, industryFilter } = req.query;

    if (!listName) {
        return res.status(400).json({ error: 'listName is required' });
    }

    const requestedTarget = parseInt(target) || 100;

    // Set up SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const sendProgress = (data) => {
        try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) { }
    };

    // Abort detection: when frontend closes connection, stop the loop
    let aborted = false;
    req.on('close', () => {
        aborted = true;
        console.log(`[ABORT] Client disconnected — generation for "${listName}" will stop.`);
    });

    try {
        const config = await loadConfig();

        const missing = [];
        if (!config.bq_project_id) missing.push('bq_project_id');
        if (!config.bq_query_template) missing.push('bq_query_template');
        if (!config.reoon_api_key) missing.push('reoon_api_key');

        if (missing.length > 0) {
            sendProgress({ type: 'error', message: `Missing configuration: ${missing.join(', ')}` });
            return res.end();
        }

        const oversampleFactor = parseFloat(config.oversample_factor || '5.0');
        const allowedStatuses = JSON.parse(config.reoon_statuses || '["safe"]');
        console.log(`\n=== LIST GENERATION: "${listName}" ===`);
        console.log(`Target: ${requestedTarget}, Gender: ${gender || 'All'}, Industry: ${industryFilter || '(any)'}, Allowed: ${JSON.stringify(allowedStatuses)}`);

        // No source filter — pull from ALL sources in master_leads
        // UNLESS enabled_sources is configured (non-empty array)
        let enabledSources = [];
        try {
            enabledSources = JSON.parse(config.enabled_sources || '[]');
        } catch (e) { enabledSources = []; }

        sendProgress({ type: 'status', message: `Starting list generation: "${listName}" — target ${requestedTarget} leads` });

        const cleanLeads = [];
        const statusBreakdown = {};
        let totalFetched = 0;
        let totalCandidatesAfterLocalFilter = 0;
        let totalSentToReoon = 0;
        let candidatesChecked = 0;
        let duplicatesSkipped = 0;
        let suppressedSkipped = 0;
        let currentOffset = 0;
        let exhausted = false;
        const seenThisRun = new Set();
        const maxCandidatesCheck = requestedTarget * 20;
        let batchNum = 0;
        const reoonSampleLog = [];  // Logs first 200 emails per run for audit CSV
        const sourceStats = {};     // Per-source Reoon result breakdown

        let baseQuery = config.bq_query_template;
        baseQuery = baseQuery.replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?[\s;]*$/i, '');
        baseQuery = baseQuery.replace(/\s+ORDER\s+BY\s+.+$/i, ''); // Remove any existing ORDER BY
        if (!baseQuery.toUpperCase().includes('WHERE')) {
            baseQuery += ' WHERE first_name IS NOT NULL';
        } else {
            baseQuery += ' AND first_name IS NOT NULL';
        }
        // Optional industry filter — injected into BigQuery WHERE clause
        if (industryFilter && industryFilter.trim()) {
            const escaped = industryFilter.trim().replace(/'/g, "''");
            baseQuery += ` AND LOWER(industry) LIKE LOWER('%${escaped}%')`;
            console.log(`[LIST] Industry filter applied: LIKE '%${escaped}%'`);
        }
        // Source filter — only pull from enabled sources (skips disabled sources like highb2b)
        if (enabledSources.length > 0) {
            const sourceList = enabledSources.map(s => `'${s.replace(/'/g, "''")}'`).join(',');
            baseQuery += ` AND source IN (${sourceList})`;
            console.log(`[LIST] Source filter applied: IN (${sourceList})`);
        }

        // Adaptive Fetch Loop
        while (cleanLeads.length < requestedTarget && !exhausted && !aborted && candidatesChecked < maxCandidatesCheck) {
            batchNum++;
            const remaining = requestedTarget - cleanLeads.length;
            const fetchSize = Math.max(100, Math.min(2000, Math.ceil(remaining * oversampleFactor)));

            sendProgress({
                type: 'progress',
                phase: 'fetching',
                batch: batchNum,
                clean: cleanLeads.length,
                target: requestedTarget,
                fetched: totalFetched,
                sent_to_reoon: totalSentToReoon,
                duplicates: duplicatesSkipped,
                suppressed: suppressedSkipped,
                breakdown: statusBreakdown,
                message: `Batch ${batchNum}: Fetching ${fetchSize} candidates from BigQuery...`
            });

            try {
                const fetchedRows = await bigqueryService.fetchLeads({
                    bq_project_id: config.bq_project_id,
                    bq_query_template: baseQuery
                }, 'All', fetchSize, currentOffset, null); // null = no source filter, pull from ALL

                currentOffset += fetchSize;

                // Check abort immediately after the slow BigQuery call
                if (aborted) {
                    console.log('[ABORT] Detected after BigQuery fetch — stopping.');
                    break;
                }

                if (!fetchedRows || fetchedRows.length === 0) {
                    exhausted = true;
                    sendProgress({ type: 'progress', phase: 'exhausted', clean: cleanLeads.length, target: requestedTarget, message: 'BigQuery source exhausted — no more rows.' });
                    break;
                }

                totalFetched += fetchedRows.length;
                candidatesChecked += fetchedRows.length;

                // Gender Filter + Sanity
                const candidates = fetchedRows.map(l => {
                    const inferredGender = genderDetection.detect(l.first_name);
                    return { ...l, inferredGender };
                }).filter(l => {
                    if (gender === 'male' || gender === 'Men') return l.inferredGender === 'male';
                    if (gender === 'female' || gender === 'Women') return l.inferredGender === 'female';
                    return true;
                }).map(l => {
                    let email = l.email;
                    if (email && typeof email === 'string' && email.includes(',')) {
                        email = email.split(',')[0].trim();
                    }
                    return { ...l, email };
                }).filter(l =>
                    l.email && l.email.includes('@') &&
                    l.first_name && l.first_name.trim().length > 0
                );

                // Cross-run dedup
                const uniqueBatch = [];
                for (const c of candidates) {
                    const norm = c.email.toLowerCase().trim();
                    if (!seenThisRun.has(norm)) {
                        seenThisRun.add(norm);
                        uniqueBatch.push({ ...c, email: norm });
                    }
                }

                if (uniqueBatch.length > 0) {
                    // DB + Suppression dedup (BEFORE Reoon!)
                    const [existingRecords, suppressedRecords] = await Promise.all([
                        prisma.lead.findMany({
                            where: { email: { in: uniqueBatch.map(c => c.email) } },
                            select: { email: true }
                        }),
                        prisma.suppressionEmail.findMany({
                            where: { email: { in: uniqueBatch.map(c => c.email) } },
                            select: { email: true }
                        })
                    ]);
                    const existingSet = new Set([
                        ...existingRecords.map(r => r.email),
                        ...suppressedRecords.map(r => r.email)
                    ]);

                    const freshCandidates = uniqueBatch.filter(c => !existingSet.has(c.email));
                    duplicatesSkipped += (uniqueBatch.length - freshCandidates.length);
                    suppressedSkipped += suppressedRecords.length;
                    totalCandidatesAfterLocalFilter += freshCandidates.length;

                    // ══════════════════════════════════════════════════════════
                    // PRE-FILTER: Reject obviously bad emails BEFORE Reoon
                    // This saves Reoon credits by never sending junk to the API
                    // ══════════════════════════════════════════════════════════
                    const ROLE_PREFIXES = new Set([
                        'info', 'admin', 'support', 'sales', 'contact', 'hello',
                        'help', 'service', 'billing', 'office', 'team', 'hr',
                        'marketing', 'press', 'media', 'webmaster', 'postmaster',
                        'noreply', 'no-reply', 'do-not-reply', 'donotreply',
                        'abuse', 'spam', 'mailer-daemon', 'root', 'hostmaster',
                        'accounts', 'enquiry', 'enquiries', 'feedback',
                        'general', 'careers', 'jobs', 'recruitment', 'newsletter',
                        'subscribe', 'unsubscribe', 'notifications', 'alerts',
                        'updates', 'orders', 'invoices', 'payments', 'returns',
                        'reception', 'security', 'compliance', 'legal', 'privacy',
                        'customerservice', 'customer-service', 'cs', 'it',
                        'tech', 'techsupport', 'helpdesk', 'ops', 'operations',
                        'mail', 'email', 'test', 'testing', 'demo', 'example',
                        'null', 'void', 'nobody', 'none', 'temp', 'temporary',
                        'user', 'default', 'www', 'ftp', 'server', 'system',
                        'sysadmin', 'administrator'
                    ]);

                    const DISPOSABLE_DOMAINS = new Set([
                        'mailinator.com', 'guerrillamail.com', 'guerrillamail.de',
                        'tempmail.com', 'throwaway.email', 'yopmail.com',
                        'trashmail.com', 'sharklasers.com', 'grr.la',
                        'guerrillamailblock.com', 'maildrop.cc', 'dispostable.com',
                        'temp-mail.org', 'fakeinbox.com', 'getnada.com',
                        'mailnesia.com', 'tempail.com', 'tempr.email',
                        'discard.email', 'mailsac.com', 'mohmal.com',
                        'burnermail.io', 'inboxkitten.com', 'minutemail.com',
                        'example.com', 'example.org', 'example.net',
                        'test.com', 'test.org', 'localhost', 'invalid.com',
                        'noemail.com', 'email.com', 'none.com', 'na.com',
                        'nomail.com', 'fake.com', 'null.com'
                    ]);

                    const preFilteredCandidates = [];
                    let preFilterRejected = 0;

                    for (const c of freshCandidates) {
                        const email = c.email;
                        const atIdx = email.indexOf('@');
                        if (atIdx < 1) { preFilterRejected++; continue; }

                        const localPart = email.substring(0, atIdx);
                        const domain = email.substring(atIdx + 1);

                        // Must have a dot in domain with valid TLD (at least 2 chars after last dot)
                        const lastDot = domain.lastIndexOf('.');
                        if (lastDot < 1 || domain.length - lastDot - 1 < 2) {
                            preFilterRejected++; continue;
                        }

                        // Reject spaces, commas, or other illegal chars
                        if (/[\s,;!#$%^&*()=+[\]{}|\\<>/"']/.test(email)) {
                            preFilterRejected++; continue;
                        }

                        // Local part must be at least 2 chars
                        if (localPart.length < 2) {
                            preFilterRejected++; continue;
                        }

                        // Reject role-based email prefixes
                        const localClean = localPart.replace(/[._\-+0-9]/g, '').toLowerCase();
                        if (ROLE_PREFIXES.has(localPart.toLowerCase()) || ROLE_PREFIXES.has(localClean)) {
                            preFilterRejected++; continue;
                        }

                        // Reject disposable/test domains
                        if (DISPOSABLE_DOMAINS.has(domain.toLowerCase())) {
                            preFilterRejected++; continue;
                        }

                        // Reject obviously fake patterns (all same char, sequential numbers as local)
                        if (/^(.)\1{4,}$/.test(localPart)) {
                            preFilterRejected++; continue;  // e.g. aaaaa@domain.com
                        }
                        if (/^\d+$/.test(localPart)) {
                            preFilterRejected++; continue;  // e.g. 12345@domain.com
                        }

                        preFilteredCandidates.push(c);
                    }

                    if (preFilterRejected > 0) {
                        console.log(`[PRE-FILTER] Rejected ${preFilterRejected}/${freshCandidates.length} emails before Reoon (role/disposable/invalid format)`);
                        statusBreakdown['pre_filtered'] = (statusBreakdown['pre_filtered'] || 0) + preFilterRejected;
                    }

                    sendProgress({
                        type: 'progress',
                        phase: 'filtered',
                        batch: batchNum,
                        clean: cleanLeads.length,
                        target: requestedTarget,
                        fetched: totalFetched,
                        sent_to_reoon: totalSentToReoon,
                        duplicates: duplicatesSkipped,
                        suppressed: suppressedSkipped,
                        breakdown: statusBreakdown,
                        pre_filtered: preFilterRejected,
                        message: `Batch ${batchNum}: ${fetchedRows.length} fetched → ${preFilteredCandidates.length} passed pre-filter (${preFilterRejected} junk rejected, ${existingRecords.length} existing, ${suppressedRecords.length} suppressed)`
                    });

                    if (preFilteredCandidates.length === 0) continue;

                    // ══════════════════════════════════════════════════════════
                    // CROSS-RUN CACHE: Check if emails were already verified in
                    // a previous run. Reuse cached status → ZERO Reoon credits.
                    // ══════════════════════════════════════════════════════════
                    const cachedResults = await prisma.lead.findMany({
                        where: {
                            email: { in: preFilteredCandidates.map(c => c.email) },
                            verifiedStatus: { not: null }
                        },
                        select: { email: true, verifiedStatus: true }
                    });
                    const cachedMap = new Map(cachedResults.map(r => [r.email, r.verifiedStatus]));
                    let cachedHits = 0;

                    // Separate into cached (free) and uncached (needs Reoon)
                    const needsReoon = [];
                    for (const c of preFilteredCandidates) {
                        const cachedStatus = cachedMap.get(c.email);
                        if (cachedStatus) {
                            cachedHits++;
                            statusBreakdown[cachedStatus] = (statusBreakdown[cachedStatus] || 0) + 1;
                            statusBreakdown['cached'] = (statusBreakdown['cached'] || 0) + 1;

                            // Log to sample CSV
                            if (reoonSampleLog.length < 200) {
                                reoonSampleLog.push({ email: c.email, source: c.source || '', status: cachedStatus, cached: true });
                            }
                            // Track per-source
                            const src = c.source || 'unknown';
                            if (!sourceStats[src]) sourceStats[src] = { total: 0, safe: 0, invalid: 0, catch_all: 0, unknown: 0, other: 0 };
                            sourceStats[src].total++;
                            sourceStats[src][cachedStatus] = (sourceStats[src][cachedStatus] || 0) + 1;

                            if (allowedStatuses.includes(cachedStatus)) {
                                cleanLeads.push({
                                    email: c.email,
                                    firstName: c.first_name || '',
                                    lastName: c.last_name || '',
                                    gender: c.inferredGender || '',
                                    company: c.company_name || c.company || '',
                                    source: c.source || '',
                                    sourceDetail: c.source_detail || '',
                                    jobTitle: c.job_title || '',
                                    industry: c.industry || '',
                                    location: c.location || '',
                                    companyDomain: c.company_domain || '',
                                    linkedinUrl: c.linkedin_url || '',
                                    sourceCampaignTag: listName,
                                    verifiedStatus: cachedStatus,
                                    verifiedAt: new Date(),
                                    pushedToManyReach: false
                                });
                            }
                        } else {
                            needsReoon.push(c);
                        }
                    }

                    if (cachedHits > 0) {
                        console.log(`[CACHE] Reused ${cachedHits} cached Reoon results (0 credits spent)`);
                    }

                    // Reoon verification — only on emails with NO cached result
                    const VERIFY_BATCH = 5;
                    for (let i = 0; i < needsReoon.length; i += VERIFY_BATCH) {
                        if (cleanLeads.length >= requestedTarget || aborted) break;

                        const batch = needsReoon.slice(i, i + VERIFY_BATCH);
                        totalSentToReoon += batch.length;

                        const results = await Promise.all(batch.map(async (lead) => {
                            try {
                                const verification = await reoonService.verifyEmail(lead.email, config.reoon_api_key);
                                return { lead, verification };
                            } catch (e) {
                                return { lead, verification: { status: 'error' } };
                            }
                        }));

                        for (const { lead, verification } of results) {
                            if (cleanLeads.length >= requestedTarget || aborted) break;
                            const status = verification.status || 'unknown';
                            statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;

                            // Log to sample CSV
                            if (reoonSampleLog.length < 200) {
                                reoonSampleLog.push({ email: lead.email, source: lead.source || '', status, cached: false });
                            }
                            // Track per-source
                            const src = lead.source || 'unknown';
                            if (!sourceStats[src]) sourceStats[src] = { total: 0, safe: 0, invalid: 0, catch_all: 0, unknown: 0, other: 0 };
                            sourceStats[src].total++;
                            if (['safe', 'invalid', 'catch_all', 'unknown'].includes(status)) {
                                sourceStats[src][status]++;
                            } else {
                                sourceStats[src].other++;
                            }

                            if (allowedStatuses.includes(status)) {
                                cleanLeads.push({
                                    email: lead.email,
                                    firstName: lead.first_name || '',
                                    lastName: lead.last_name || '',
                                    gender: lead.inferredGender || '',
                                    company: lead.company_name || lead.company || '',
                                    source: lead.source || '',
                                    sourceDetail: lead.source_detail || '',
                                    jobTitle: lead.job_title || '',
                                    industry: lead.industry || '',
                                    location: lead.location || '',
                                    companyDomain: lead.company_domain || '',
                                    linkedinUrl: lead.linkedin_url || '',
                                    sourceCampaignTag: listName,
                                    verifiedStatus: status,
                                    verifiedAt: new Date(),
                                    pushedToManyReach: false
                                });
                            }
                        }

                        // Send progress after every verify batch
                        sendProgress({
                            type: 'progress',
                            phase: 'verifying',
                            batch: batchNum,
                            clean: cleanLeads.length,
                            target: requestedTarget,
                            fetched: totalFetched,
                            sent_to_reoon: totalSentToReoon,
                            duplicates: duplicatesSkipped,
                            suppressed: suppressedSkipped,
                            breakdown: statusBreakdown,
                            message: `Verified: ${cleanLeads.length}/${requestedTarget} clean leads (${totalSentToReoon} Reoon calls, ${cachedHits} cached)`
                        });
                    }
                }

            } catch (err) {
                console.error('Error in list fetch loop:', err.message);
                sendProgress({ type: 'progress', phase: 'error_in_batch', message: `Error in batch ${batchNum}: ${err.message}. Continuing with ${cleanLeads.length} leads...` });
                if (cleanLeads.length === 0) {
                    sendProgress({ type: 'error', message: err.message });
                    return res.end();
                }
                exhausted = true;
                break;
            }
        } // End While

        if (aborted) {
            console.log(`[ABORT] Generation stopped by user. Saving ${cleanLeads.length} leads collected so far.`);
        }

        // Save to DB (even if aborted — save partial results)
        sendProgress({ type: 'progress', phase: 'saving', clean: cleanLeads.length, target: requestedTarget, message: aborted ? `Stopped! Saving ${cleanLeads.length} leads collected so far...` : `Saving ${cleanLeads.length} leads to database...` });

        if (cleanLeads.length > 0) {
            const DB_BATCH = 500;
            for (let i = 0; i < cleanLeads.length; i += DB_BATCH) {
                const chunk = cleanLeads.slice(i, i + DB_BATCH);
                const existing = await prisma.lead.findMany({
                    where: { email: { in: chunk.map(c => c.email) } },
                    select: { email: true }
                });
                const existSet = new Set(existing.map(e => e.email));
                const fresh = chunk.filter(c => !existSet.has(c.email));
                if (fresh.length > 0) {
                    await prisma.lead.createMany({ data: fresh });
                }
                sendProgress({ type: 'progress', phase: 'saving', message: `Saved ${i + chunk.length}/${cleanLeads.length} leads (${existing.length} dupes skipped).` });
            }
        }

        console.log(`=== LIST COMPLETE: "${listName}" — ${cleanLeads.length} clean leads ===\n`);

        // Save sample audit CSV for this run
        let sampleCsvPath = null;
        if (reoonSampleLog.length > 0) {
            const samplesDir = path.join(__dirname, 'reoon_samples');
            if (!fs.existsSync(samplesDir)) fs.mkdirSync(samplesDir, { recursive: true });
            const safeName = listName.replace(/[^a-zA-Z0-9_-]/g, '_');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            sampleCsvPath = path.join(samplesDir, `${safeName}_${timestamp}.csv`);
            const csvHeader = 'email,source,reoon_status,cached\n';
            const csvRows = reoonSampleLog.map(r => `${r.email},${r.source},${r.status},${r.cached}`).join('\n');
            fs.writeFileSync(sampleCsvPath, csvHeader + csvRows);
            console.log(`[AUDIT] Sample CSV saved: ${sampleCsvPath} (${reoonSampleLog.length} entries)`);
        }

        // Log per-source stats
        if (Object.keys(sourceStats).length > 0) {
            console.log('[PER-SOURCE STATS]');
            for (const [src, stats] of Object.entries(sourceStats)) {
                const safeRate = stats.total > 0 ? Math.round(stats.safe / stats.total * 100) : 0;
                console.log(`  ${src}: ${stats.total} checked, ${stats.safe} safe (${safeRate}%), ${stats.invalid} invalid, ${stats.catch_all} catch_all, ${stats.unknown} unknown`);
            }
        }

        sendProgress({
            type: 'done',
            success: true,
            listName,
            requested: requestedTarget,
            stats: {
                totalFetched,
                totalCandidatesAfterLocalFilter,
                totalSentToReoon,
                totalVerifiedClean: cleanLeads.length,
                duplicatesSkipped,
                suppressedSkipped,
                candidatesChecked,
                statusBreakdown,
                sourceStats,
                sampleCsvEntries: reoonSampleLog.length,
                sampleCsvFile: sampleCsvPath ? path.basename(sampleCsvPath) : null
            },
            cleanLeads: cleanLeads.length,
            exhausted,
            message: cleanLeads.length < requestedTarget
                ? `Generated ${cleanLeads.length} leads (Target ${requestedTarget}). Source exhausted after checking ${candidatesChecked} candidates.`
                : `Successfully generated ${cleanLeads.length} clean leads for list "${listName}".`
        });
        res.end();

    } catch (error) {
        console.error('Error in list generation:', error);
        sendProgress({ type: 'error', message: error.message });
        res.end();
    }
});

// ─── REOON SAMPLE AUDIT CSVs ──────────────────────────────────────────────
app.get('/api/reoon-samples', (req, res) => {
    const samplesDir = path.join(__dirname, 'reoon_samples');
    if (!fs.existsSync(samplesDir)) return res.json({ files: [] });
    const files = fs.readdirSync(samplesDir)
        .filter(f => f.endsWith('.csv'))
        .sort()
        .reverse()
        .slice(0, 20); // Last 20 samples
    res.json({ files });
});

app.get('/api/reoon-samples/:filename', (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9_.\-]/g, '');
    const filepath = path.join(__dirname, 'reoon_samples', filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filepath).pipe(res);
});

// Rotate debug logs on startup
function rotateLogs() {
    ['bq_debug.log', 'push_debug.log'].forEach(file => {
        if (fs.existsSync(file)) {
            const stats = fs.statSync(file);
            if (stats.size > 0) {
                // Keep last 3 versions
                if (fs.existsSync(`${file}.2`)) fs.renameSync(`${file}.2`, `${file}.3`);
                if (fs.existsSync(`${file}.1`)) fs.renameSync(`${file}.1`, `${file}.2`);
                fs.renameSync(file, `${file}.1`);
                console.log(`Rotated log ${file} -> ${file}.1`);
            }
        }
    });
}
rotateLogs();

// ─── START SERVER ────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// ─── GET LEADS ──────────────────────────────────────────────────────────
app.get('/api/leads', async (req, res) => {
    try {
        const { sourceCampaignTag, source, industry, jobTitle, page = 1, limit = 100 } = req.query;

        const where = {};
        if (sourceCampaignTag) where.sourceCampaignTag = sourceCampaignTag;
        if (source) where.source = source;
        if (industry) where.industry = { contains: industry };
        if (jobTitle) where.jobTitle = { contains: jobTitle };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [leads, total] = await Promise.all([
            prisma.lead.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.lead.count({ where })
        ]);

        res.json({
            leads,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / take)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── GET DISTINCT FILTER VALUES (for Browse Leads dropdowns) ────────────
app.get('/api/leads/filters', async (req, res) => {
    try {
        const [sources, industries, jobTitles] = await Promise.all([
            prisma.lead.findMany({
                select: { source: true },
                distinct: ['source'],
                where: { source: { not: '' } },
                orderBy: { source: 'asc' }
            }),
            prisma.lead.findMany({
                select: { industry: true },
                distinct: ['industry'],
                where: { industry: { not: '' } },
                orderBy: { industry: 'asc' }
            }),
            prisma.lead.findMany({
                select: { jobTitle: true },
                distinct: ['jobTitle'],
                where: { jobTitle: { not: '' } },
                orderBy: { jobTitle: 'asc' }
            })
        ]);

        res.json({
            sources: sources.map(s => s.source).filter(Boolean),
            industries: industries.map(s => s.industry).filter(Boolean),
            jobTitles: jobTitles.map(s => s.jobTitle).filter(Boolean)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── GET CAMPAIGN TAGS (distinct sourceCampaignTag values) ──────────────
app.get('/api/campaigns/tags', async (req, res) => {
    try {
        const tags = await prisma.lead.findMany({
            select: { sourceCampaignTag: true },
            distinct: ['sourceCampaignTag'],
            orderBy: { sourceCampaignTag: 'asc' }
        });
        res.json(tags.map(t => t.sourceCampaignTag));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── GET LEAD STATS (summary counts per list/campaign tag) ──────────────
app.get('/api/leads/stats', async (req, res) => {
    try {
        const tags = await prisma.lead.findMany({
            select: { sourceCampaignTag: true },
            distinct: ['sourceCampaignTag']
        });

        const stats = await Promise.all(tags.map(async ({ sourceCampaignTag }) => {
            const total = await prisma.lead.count({ where: { sourceCampaignTag } });

            return {
                sourceCampaignTag,
                total
            };
        }));

        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── PHASE 2: PUSH TO MANYREACH (DISABLED — use CSV export instead) ─────
// ManyReach integration is disabled in this version.
// Export leads as CSV and upload manually.
app.post('/api/leads/push', async (req, res) => {
    return res.status(410).json({
        error: 'ManyReach push is disabled in this version. Export leads as CSV and upload manually.',
        tip: 'Use the CSV Export button in Browse Leads or Lead Stats.'
    });
    // Original push code below (disabled):
    const {
        sourceCampaignTag,      // Required: which campaign tag to push
        campaignIdOverride,     // Optional: override the stored ManyReach campaign ID
        listIdOverride,         // Optional: override the stored ManyReach list ID
        batchSize: batchSizeOverride,  // Optional: override batch size
        batchDelay: batchDelayOverride // Optional: override batch delay in ms
    } = req.body;

    if (!sourceCampaignTag) {
        return res.status(400).json({ error: 'sourceCampaignTag is required' });
    }

    try {
        console.log('Received push request:', JSON.stringify(req.body));
        require('fs').writeFileSync('push_entry.log', `[${new Date().toISOString()}] Received push request: ${JSON.stringify(req.body)}\n`);

        const config = await loadConfig();

        if (!config.manyreach_api_key) throw new Error('ManyReach API Key missing');

        // Auto-provision list ID (creates "Lead App Imports" if needed)
        const listId = listIdOverride || await ensureListId(config.manyreach_api_key);
        console.log(`Using ManyReach list ID: ${listId}`);

        // Fetch unpushed leads for this campaign tag
        const unpushedLeads = await prisma.lead.findMany({
            where: {
                sourceCampaignTag,
                pushedToManyReach: false
            }
        });

        if (unpushedLeads.length === 0) {
            return res.json({
                success: true,
                message: 'No unpushed leads found for this campaign tag',
                pushed: 0
            });
        }

        // Determine the campaign ID
        const campaignId = campaignIdOverride || unpushedLeads[0].manyreachCampaignId;
        if (!campaignId) {
            throw new Error('No ManyReach Campaign ID found. Provide campaignIdOverride or ensure leads have manyreachCampaignId set.');
        }

        // Batch settings
        const batchSize = parseInt(batchSizeOverride || config.manyreach_batch_size || '50');
        const batchDelay = parseInt(batchDelayOverride || config.manyreach_batch_delay || '2000');
        const retryDelay = parseInt(config.manyreach_retry_delay || '5000');
        const MAX_RETRIES = 3;

        console.log(`Pushing ${unpushedLeads.length} leads to ManyReach campaign ${campaignId}, list ${listId}`);
        console.log(`Batch size: ${batchSize}, delay: ${batchDelay}ms, retry delay: ${retryDelay}ms`);

        let totalPushed = 0;
        let totalFailed = 0;
        const batchResults = [];

        // Process in batches
        for (let i = 0; i < unpushedLeads.length; i += batchSize) {
            const batch = unpushedLeads.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(unpushedLeads.length / batchSize);

            console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} leads)...`);
            console.log(`Pushing to List ID Type: ${typeof listId}, Value: "${listId}"`);
            console.log(`Pushing to Campaign ID: ${campaignId}`);

            let attempt = 0;
            let success = false;
            let lastError = null;

            require('fs').appendFileSync('push_debug.log',
                `[${new Date().toISOString()}] Batch ${batchNum}: listId type=${typeof listId}, val='${listId}', campaignId type=${typeof campaignId}, val='${campaignId}'\n`);

            while (attempt < MAX_RETRIES && !success) {
                attempt++;
                try {
                    // Call ManyReach bulk API
                    const result = await manyreachService.bulkAddProspects(
                        batch.map(lead => ({
                            email: lead.email,
                            firstName: lead.firstName || '',
                            lastName: lead.lastName || '',
                            company: lead.company || ''
                        })),
                        listId,
                        campaignId,
                        config.manyreach_api_key,
                        { addOnlyIfNew: true }
                    );

                    // Mark leads as pushed
                    const leadIds = batch.map(l => l.id);
                    await prisma.lead.updateMany({
                        where: { id: { in: leadIds } },
                        data: {
                            pushedToManyReach: true,
                            pushedAt: new Date(),
                            manyreachListId: String(listId),
                            pushError: null
                        }
                    });

                    // Update count based on actual API success
                    const actualSuccess = result.campaignAdded ?? result.prospectsInserted ?? batch.length;
                    totalPushed += actualSuccess;

                    batchResults.push({
                        batch: batchNum,
                        count: batch.length,
                        status: 'success',
                        accepted: actualSuccess,
                        attempt,
                        apiResult: result,
                        warning: actualSuccess < batch.length ? `ManyReach filtered out ${batch.length - actualSuccess} leads (duplicates or invalid)` : null
                    });

                    success = true;
                    console.log(`Batch ${batchNum} succeeded (attempt ${attempt}). Accepted: ${actualSuccess}/${batch.length}`);
                } catch (err) {
                    console.error(`Batch ${batchNum} failed:`, err.message);
                    lastError = err.message;

                    // Log error to file
                    require('fs').appendFileSync('push_debug.log',
                        `[${new Date().toISOString()}] Batch ${batchNum} ERROR: ${err.message}\n`);

                    // Rate limit handling
                    if (String(err).includes('429')) {
                        const waitTime = retryDelay * Math.pow(2, attempt); // Exponential backoff
                        console.log(`Rate limit hit. Waiting ${waitTime}ms...`);
                        await new Promise(r => setTimeout(r, waitTime));
                    } else {
                        // For non-rate-limit errors, maybe wait a bit and retry? 
                        // Or just fail? 
                        // If it's a timeout, we should probably stop retrying immediately to avoid compounding.
                        if (String(err).includes('timeout')) {
                            success = false;
                            break; // Stop retrying this batch
                        }
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }

            if (!success) {
                // Mark batch as failed
                const leadIds = batch.map(l => l.id);
                await prisma.lead.updateMany({
                    where: { id: { in: leadIds } },
                    data: { pushError: lastError }
                });

                totalFailed += batch.length;
                batchResults.push({
                    batch: batchNum,
                    count: batch.length,
                    status: 'failed',
                    attempts: attempt,
                    error: lastError
                });

                console.error(`Batch ${batchNum} failed after ${MAX_RETRIES} attempts`);
            }

            // Delay between batches (avoid hammering the API)
            if (i + batchSize < unpushedLeads.length) {
                console.log(`Waiting ${batchDelay}ms before next batch...`);
                await sleep(batchDelay);
            }
        }

        // Return structured result with error classification if failed
        const isSuccess = totalPushed > 0 && totalFailed === 0;
        let mainErrorCategory = null;
        let mainErrorMessage = null;

        if (totalFailed > 0 && batchResults.length > 0) {
            // Find the most common error or last error
            const lastFailedBatch = batchResults.find(b => b.status === 'failed');
            if (lastFailedBatch) {
                const errMsg = String(lastFailedBatch.error);
                mainErrorMessage = errMsg;
                if (errMsg.includes('429')) mainErrorCategory = 'rateLimit';
                else if (errMsg.includes('401') || errMsg.includes('key')) mainErrorCategory = 'auth';
                else if (errMsg.includes('listId')) mainErrorCategory = 'badListId';
                else if (errMsg.includes('closed') || errMsg.includes('sender')) mainErrorCategory = 'campaignClosed';
                else mainErrorCategory = 'network';
            }
        }

        res.json({
            success: isSuccess,
            errorCategory: mainErrorCategory,
            message: mainErrorMessage ? `Failed to push some leads: ${mainErrorMessage}` : undefined,
            sourceCampaignTag,
            campaignId,
            listId,
            totalLeads: unpushedLeads.length,
            totalPushed,
            totalFailed,
            batches: batchResults
        });

    } catch (error) {
        console.error('Error in push flow:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── SUPPRESSION LIST MANAGEMENT ─────────────────────────────────────────

// Get suppression list stats
app.get('/api/suppression/stats', async (req, res) => {
    try {
        const total = await prisma.suppressionEmail.count();
        const bySource = await prisma.suppressionEmail.groupBy({
            by: ['source'],
            _count: true
        });
        res.json({ total, bySource });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload suppression list (text body with emails, one per line)
app.post('/api/suppression/upload', express.text({ limit: '50mb' }), async (req, res) => {
    try {
        const rawText = req.body;
        if (!rawText || typeof rawText !== 'string') {
            return res.status(400).json({ error: 'Send a text body with emails, one per line' });
        }

        // Parse emails: handle CSV rows, one-per-line, comma-separated
        const emails = rawText
            .split(/[\r\n,]+/)
            .map(e => e.trim().toLowerCase())
            .filter(e => e && e.includes('@'))
            // Remove header-like rows
            .filter(e => !e.startsWith('email') && !e.startsWith('first'));

        if (emails.length === 0) {
            return res.status(400).json({ error: 'No valid emails found in the upload' });
        }

        // Batch insert, skip duplicates via raw SQL INSERT OR IGNORE
        const BATCH = 500;
        let inserted = 0;
        for (let i = 0; i < emails.length; i += BATCH) {
            const chunk = emails.slice(i, i + BATCH);
            for (const email of chunk) {
                try {
                    await prisma.$executeRawUnsafe(
                        `INSERT OR IGNORE INTO suppression_emails (email, source, createdAt) VALUES (?, 'csv_import', datetime('now'))`,
                        email
                    );
                    inserted++;
                } catch (e) { /* duplicate, skip */ }
            }
        }

        const total = await prisma.suppressionEmail.count();
        console.log(`Suppression list: uploaded ${inserted} new emails (${emails.length} in file, ${total} total)`);

        res.json({
            success: true,
            emailsInFile: emails.length,
            newEmailsAdded: inserted,
            totalSuppressed: total
        });
    } catch (error) {
        console.error('Suppression upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync suppression list from existing leads in DB
app.post('/api/suppression/sync-from-leads', async (req, res) => {
    try {
        const allLeads = await prisma.lead.findMany({
            select: { email: true }
        });

        const BATCH = 500;
        let inserted = 0;
        for (let i = 0; i < allLeads.length; i += BATCH) {
            const chunk = allLeads.slice(i, i + BATCH);
            for (const l of chunk) {
                try {
                    await prisma.$executeRawUnsafe(
                        `INSERT OR IGNORE INTO suppression_emails (email, source, createdAt) VALUES (?, 'existing_leads', datetime('now'))`,
                        l.email.toLowerCase().trim()
                    );
                    inserted++;
                } catch (e) { /* duplicate, skip */ }
            }
        }

        const total = await prisma.suppressionEmail.count();
        console.log(`Suppression list: synced ${inserted} emails from ${allLeads.length} existing leads (${total} total)`);

        res.json({
            success: true,
            existingLeads: allLeads.length,
            newEmailsAdded: inserted,
            totalSuppressed: total
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear suppression list
app.delete('/api/suppression/clear', async (req, res) => {
    try {
        const deleted = await prisma.suppressionEmail.deleteMany({});
        res.json({ success: true, deleted: deleted.count });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// ─── EXPORT LEADS AS CSV (STREAMING FOR LARGE LISTS) ────────────────────
app.get('/api/leads/export', async (req, res) => {
    try {
        const { sourceCampaignTag, pushedToManyReach } = req.query;

        const where = {};
        if (sourceCampaignTag) where.sourceCampaignTag = sourceCampaignTag;
        if (pushedToManyReach !== undefined) {
            where.pushedToManyReach = pushedToManyReach === 'true';
        }

        const totalCount = await prisma.lead.count({ where });
        console.log(`CSV Export: ${totalCount} leads for tag "${sourceCampaignTag || 'all'}"`);

        const headers = ['email', 'firstName', 'lastName', 'gender', 'company',
            'source', 'sourceDetail', 'jobTitle', 'industry', 'location',
            'companyDomain', 'linkedinUrl',
            'sourceCampaignTag', 'verifiedStatus', 'verifiedAt', 'createdAt'];

        function escapeCSV(val) {
            if (val === null || val === undefined) val = '';
            if (val instanceof Date) val = val.toISOString();
            val = String(val).replace(/"/g, '""');
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = `"${val}"`;
            }
            return val;
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${sourceCampaignTag || 'leads'}-${Date.now()}.csv"`);

        // Write header
        res.write(headers.join(',') + '\n');

        // Stream in batches of 1000
        const BATCH = 1000;
        let cursor = undefined;
        let exported = 0;

        while (true) {
            const query = {
                where,
                orderBy: { id: 'asc' },
                take: BATCH,
            };
            if (cursor) {
                query.skip = 1;
                query.cursor = { id: cursor };
            }

            const batch = await prisma.lead.findMany(query);
            if (batch.length === 0) break;

            for (const lead of batch) {
                const row = headers.map(h => escapeCSV(lead[h]));
                res.write(row.join(',') + '\n');
            }

            exported += batch.length;
            cursor = batch[batch.length - 1].id;
            console.log(`CSV Export: streamed ${exported}/${totalCount} rows...`);

            if (batch.length < BATCH) break;
        }

        console.log(`CSV Export complete: ${exported} rows.`);
        res.end();
    } catch (error) {
        console.error('CSV Export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.end();
        }
    }
});

// ─── UTILITY ─────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Catch-all: serve React SPA for any non-API routes (must be AFTER all API routes)
app.get('*', (req, res) => {
    const indexPath = path.join(clientDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Not found');
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
