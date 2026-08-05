/**
 * Wraps an async Express route handler so any thrown error (including a
 * rejected promise - a failed DB query, a bad UUID cast, anything) is
 * forwarded to Express's error-handling middleware instead of becoming an
 * unhandled promise rejection.
 *
 * Why this matters: Express 4 does NOT automatically catch errors thrown
 * inside an `async (req, res) => {...}` handler. An uncaught rejection in
 * one of those crashes the entire Node process - not just that one request -
 * taking down every other in-flight request and requiring a manual restart.
 * This has happened more than once tonight (an invalid UUID sent to a raw
 * Postgres query, in more than one route). Wrapping every route with this
 * fixes the whole class of bug at once, rather than adding a one-off check
 * to whichever specific field crashed most recently.
 *
 * Usage:
 *   businessRouter.post('/devices/login', asyncHandler(async (req, res) => {
 *     ... same handler body as before, no other changes needed ...
 *   }));
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}