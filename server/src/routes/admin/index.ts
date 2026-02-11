export default () => ({
  type: 'admin',
  routes: [
    {
      method: 'GET',
      path: '/status',
      handler: 'controller.getStatus',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/events',
      handler: 'controller.getEvents',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'DELETE',
      path: '/events',
      handler: 'controller.clearEvents',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
  ],
});
