// backend/fastify/routes/usernameRoutes.js
import { usernameService } from '../../shared/usernameService.js';

/**
 * Username API Routes
 * Manages wallet address -> username mappings
 */
export default async function usernameRoutes(fastify) {
  
  /**
   * GET /api/usernames/:address
   * Get username for a wallet address
   */
  fastify.get('/:address', async (request, reply) => {
    const { address } = request.params;
    
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: 'Invalid wallet address' });
    }

    const username = await usernameService.getUsernameByAddress(address);
    
    return reply.send({
      address,
      username: username || null
    });
  });

  /**
   * POST /api/usernames
   * Set username for a wallet address
   * Body: { address: string, username: string }
   */
  fastify.post('/', async (request, reply) => {
    const { address, username } = request.body;

    // Validate address
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: 'Invalid wallet address' });
    }

    // Validate username
    if (!username || typeof username !== 'string') {
      return reply.code(400).send({ error: 'Username is required' });
    }

    const result = await usernameService.setUsername(address, username);

    if (!result.success) {
      const statusCode = result.error === 'USERNAME_TAKEN' ? 409 : 400;
      return reply.code(statusCode).send({ error: result.error });
    }

    return reply.send({
      success: true,
      address,
      username
    });
  });

  /**
   * GET /api/usernames/check/:username
   * Check if username is available
   */
  fastify.get('/check/:username', async (request, reply) => {
    const { username } = request.params;

    if (!username) {
      return reply.code(400).send({ error: 'Username is required' });
    }

    const validation = usernameService.validateUsername(username);
    if (!validation.valid) {
      return reply.send({
        available: false,
        error: validation.error
      });
    }

    const available = await usernameService.isUsernameAvailable(username);

    return reply.send({
      available,
      username
    });
  });

  /**
   * GET /api/usernames/batch
   * Get usernames for multiple addresses
   * Query: ?addresses=0x123,0x456,0x789
   */
  fastify.get('/batch', async (request, reply) => {
    const { addresses } = request.query;

    if (!addresses) {
      return reply.code(400).send({ error: 'Addresses query parameter is required' });
    }

    const addressArray = addresses.split(',').map(addr => addr.trim());
    
    // Validate all addresses
    const invalidAddresses = addressArray.filter(addr => !/^0x[a-fA-F0-9]{40}$/.test(addr));
    if (invalidAddresses.length > 0) {
      return reply.code(400).send({ 
        error: 'Invalid wallet addresses',
        invalid: invalidAddresses
      });
    }

    const usernamesMap = await usernameService.getBatchUsernames(addressArray);
    
    // Convert Map to object for JSON response
    const result = {};
    usernamesMap.forEach((username, address) => {
      result[address] = username;
    });

    return reply.send(result);
  });

  /**
   * GET /api/usernames/all
   * Get all username mappings (admin/debug endpoint)
   */
  fastify.get('/all', async (request, reply) => {
    const allUsernames = await usernameService.getAllUsernames();
    
    return reply.send({
      count: allUsernames.length,
      usernames: allUsernames
    });
  });
}
