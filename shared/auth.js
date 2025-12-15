import jwt from 'jsonwebtoken';
import { db } from './supabaseClient.js';
import process from 'node:process';

const JWT_SECRET = process.env.JWT_SECRET || 'secondorder_fun_secret_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export class AuthService {
  static async generateToken(user) {
    const payload = {
      id: user.id,
      wallet_address: user.wallet_address,
      role: user.role || 'user'
    };
    
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }
  
  static async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return { valid: true, user: decoded };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
  
  static async authenticateRequest(request) {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header');
    }
    
    const token = authHeader.substring(7);
    const result = await this.verifyToken(token);
    
    if (!result.valid) {
      throw new Error('Invalid or expired token');
    }
    
    return result.user;
  }
  
  static async authenticateFarcaster(request) {
    // request parameter required by interface but not used in this implementation
    if (request) {
      // Intentionally empty - request parameter required by interface
    }
    // TODO: Implement Farcaster authentication
    // This would involve verifying the Farcaster signature
    // and creating or retrieving the user
    return null;
  }
  
  static async createUserFromWallet(walletAddress) {
    // Check if user already exists
    let user = await db.getUserByAddress(walletAddress);
    
    if (!user) {
      // Create new user
      user = await db.createUser({
        wallet_address: walletAddress,
        display_name: `User_${walletAddress.substring(0, 6)}`,
        role: 'user',
        created_at: new Date().toISOString()
      });
    }
    
    return user;
  }
}

// Fastify authentication decorator
export async function authenticateFastify(app) {
  app.decorateRequest('user', null);
  
  app.addHook('preHandler', async (request, reply) => {
    // reply parameter required by Fastify hook interface but not used in this implementation
    if (reply) {
      // Intentionally empty - reply parameter required by Fastify hook interface
    }
    try {
      const user = await AuthService.authenticateRequest(request);
      request.user = user;
    } catch (error) {
      // Allow unauthenticated requests for public endpoints
      app.log.error('Authentication error:', error);
    }
  });
}

export default AuthService;