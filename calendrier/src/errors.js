/* Erreur métier portant le code HTTP à renvoyer.
   Tout ce qui n'est pas une ApiError remonte en 500 : c'est un bug, pas une
   saisie invalide. */
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

const badRequest = (message, details) => new ApiError(400, 'invalid_request', message, details);
const notFound = (message) => new ApiError(404, 'not_found', message);
const conflict = (message, details) => new ApiError(409, 'conflict', message, details);

module.exports = { ApiError, badRequest, notFound, conflict };
