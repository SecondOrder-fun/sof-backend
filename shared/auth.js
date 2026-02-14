import jwt from "jsonwebtoken";
import process from "node:process";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET env var is required");
}

if (!JWT_EXPIRES_IN) {
  throw new Error("JWT_EXPIRES_IN env var is required");
}

export class AuthService {
  static async generateToken(user) {
    const payload = {
      id: user.id,
      wallet_address: user.wallet_address,
      role: user.role || "user",
    };

    if (user.fid) {
      payload.fid = user.fid;
    }

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

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Missing or invalid authorization header");
    }

    const token = authHeader.substring(7);
    const result = await this.verifyToken(token);

    if (!result.valid) {
      throw new Error("Invalid or expired token");
    }

    return result.user;
  }

  static async authenticateFarcaster(message, signature, nonce) {
    const { createAppClient, viemConnector } = await import("@farcaster/auth-client");

    const appClient = createAppClient({ ethereum: viemConnector() });

    // Extract domain from the SIWE message (first line: "{domain} wants you to sign in...")
    const messageDomain = message.split(" ")[0];
    if (!messageDomain) {
      throw new Error("Could not extract domain from SIWF message");
    }

    // Validate domain against allowlist
    const allowedDomains = (process.env.SIWF_ALLOWED_DOMAINS || process.env.SIWF_DOMAIN || "secondorder.fun")
      .split(",")
      .map((d) => d.trim());

    const isDomainAllowed = allowedDomains.some((allowed) => {
      if (allowed.startsWith("*.")) {
        // Wildcard: *.vercel.app matches any-subdomain.vercel.app
        return messageDomain.endsWith(allowed.slice(1));
      }
      return messageDomain === allowed;
    });

    if (!isDomainAllowed) {
      throw new Error(`SIWF domain not allowed: ${messageDomain}`);
    }

    const result = await appClient.verifySignInMessage({
      message,
      signature,
      domain: messageDomain,
      nonce,
    });

    if (!result.success) {
      throw new Error("SIWF signature verification failed");
    }

    return { fid: result.fid };
  }

}

// Fastify authentication decorator
export async function authenticateFastify(app) {
  app.decorateRequest("user", null);

  app.addHook("preHandler", async (request, reply) => {
    // reply parameter required by Fastify hook interface but not used in this implementation
    if (reply) {
      // Intentionally empty - reply parameter required by Fastify hook interface
    }
    try {
      const user = await AuthService.authenticateRequest(request);
      request.user = user;
    } catch (error) {
      // Allow unauthenticated requests for public endpoints
      app.log.error("Authentication error:", error);
    }
  });
}

export default AuthService;
