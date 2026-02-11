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
  ],
});
