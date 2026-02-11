export const TOO_MANY_REQUESTS_BODY = Object.freeze({
  data: null,
  error: Object.freeze({
    status: 429,
    name: 'TooManyRequestsError',
    message: 'Too many requests, please try again later.',
    details: Object.freeze({}),
  }),
});
