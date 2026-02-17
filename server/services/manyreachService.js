const axios = require('axios');

const BASE_URL = 'https://api.manyreach.com/api/v2';

function getHeaders(apiKey) {
    return {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
    };
}

/**
 * Create a new campaign in ManyReach
 * POST /api/v2/campaigns
 */
async function createCampaign(name, apiKey) {
    if (!apiKey) throw new Error('ManyReach API key missing');

    try {
        const response = await axios.post(`${BASE_URL}/campaigns`, {
            name: name
        }, {
            headers: getHeaders(apiKey)
        });

        console.log('ManyReach create response:', JSON.stringify(response.data));

        // Handle various response shapes
        const id = response.data?.id || response.data?.campaignId || response.data?.data?.id;

        if (!id) {
            throw new Error(`ManyReach created campaign but no ID returned. Response: ${JSON.stringify(response.data)}`);
        }

        return id;
    } catch (error) {
        console.error('ManyReach createCampaign error:', error.response?.data || error.message);
        throw new Error('Failed to create ManyReach campaign: ' + (error.response?.data?.message || error.message));
    }
}

/**
 * Create a new mailing list in ManyReach
 * POST /api/v2/lists
 * Required: { title: string }
 * Returns: { id: number, title: string, ... }
 */
async function createList(title, apiKey) {
    if (!apiKey) throw new Error('ManyReach API key missing');

    try {
        const response = await axios.post(`${BASE_URL}/lists`, {
            title: title
        }, {
            headers: getHeaders(apiKey)
        });

        return response.data; // { id, title, ... }
    } catch (error) {
        console.error('ManyReach createList error:', error.response?.data || error.message);
        throw new Error('Failed to create ManyReach list: ' + (error.response?.data?.message || error.message));
    }
}

/**
 * Get all lists from ManyReach
 * GET /api/v2/lists
 */
async function getLists(apiKey) {
    if (!apiKey) throw new Error('ManyReach API key missing');

    try {
        const response = await axios.get(`${BASE_URL}/lists`, {
            headers: getHeaders(apiKey)
        });

        return response.data?.items || response.data || [];
    } catch (error) {
        console.error('ManyReach getLists error:', error.response?.data || error.message);
        throw new Error('Failed to get ManyReach lists: ' + (error.response?.data?.message || error.message));
    }
}

/**
 * Bulk add prospects to a list and optionally a campaign
 * POST /api/v2/prospects/bulk?listId={listId}&campaignId={campaignId}
 * 
 * Body: { prospects: [{ email, firstName, lastName, company, ... }] }
 * Each prospect follows the ProspectBulkCreate schema (email required).
 * 
 * Query params:
 *   - listId (required): The list ID to add prospects to
 *   - campaignId (optional): The campaign ID to add prospects to
 *   - addOnlyIfNew (optional, default false): Only add if not already in CRM
 *   - notInOtherCampaign (optional, default false): Skip if in another campaign
 * 
 * Returns ProspectImport: { totalProcessed, prospectsInserted, prospectsUpdated, 
 *                           duplicatesInBatch, subscriptionsAdded, campaignAdded }
 */
async function bulkAddProspects(prospects, listId, campaignId, apiKey, options = {}) {
    if (!apiKey) throw new Error('ManyReach API key missing');
    if (!listId) throw new Error('ManyReach listId is required for bulk prospect import');
    if (!prospects || prospects.length === 0) throw new Error('No prospects to add');

    // V2 API expects listId and campaignId in the body for bulk import
    const formattedProspects = prospects.map(p => ({
        email: p.email,
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        company: p.company || '',
        // Add any additional fields that are available
        ...(p.phone && { phone: p.phone }),
        ...(p.website && { website: p.website }),
        ...(p.jobPosition && { jobPosition: p.jobPosition }),
        ...(p.country && { country: p.country }),
        ...(p.city && { city: p.city }),
    }));

    // Build query params for options ONLY
    const params = new URLSearchParams();
    // listId is REQUIRED in query params according to API docs, let's keep it there
    // BUT we must ensure it is a string!
    if (!listId) throw new Error('List ID is missing and required');

    // Explicitly add required params
    params.append('listId', String(listId));

    if (campaignId) params.append('campaignId', String(campaignId));
    if (options.addOnlyIfNew) params.append('addOnlyIfNew', 'true');
    if (options.notInOtherCampaign) params.append('notInOtherCampaign', 'true');

    try {
        const url = `${BASE_URL}/prospects/bulk?${params.toString()}`;
        console.log(`Calling ManyReach Bulk API: ${url}`);

        const response = await axios.post(
            url,
            { prospects: formattedProspects },
            { headers: getHeaders(apiKey), timeout: 300000 }
        );

        console.log('ManyReach bulk import result:', response.data);
        return response.data; // ProspectImport object
    } catch (error) {
        console.error('ManyReach bulkAddProspects error:', error.response?.data || error.message);
        throw new Error('Failed to bulk add prospects: ' + (error.response?.data?.message || error.message));
    }
}

module.exports = { createCampaign, createList, getLists, bulkAddProspects };
