// This endpoint was a byte-for-byte duplicate of /api/team/members, including
// an ungated DELETE that removed any membership row by id. It now re-exports
// the gated handlers so there is exactly one implementation to audit.
export { GET, DELETE } from "./members/route";
