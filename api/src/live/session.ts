/*
Reexporta getSessionUserId desde el middleware central.
Se mantiene este archivo por compatibilidad con imports existentes en live/*.
*/
export { getSessionUserId } from "../middleware/requireAuth";
