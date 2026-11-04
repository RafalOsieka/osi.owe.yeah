/**
 * Who runs this instance of Owe Yeah: the controller the privacy notice (`/privacy`) and the
 * service provider the terms (`/terms`) name. Written for osieka.dev's instance; whoever runs
 * their own replaces it, along with both pages' text (`deploy/osieka-dev/README.md`). The
 * terms point to the business's public CEIDG entry for its address rather than printing one.
 */
export const OPERATOR = {
  name: 'Rafał Osieka',
  business: 'osieka.dev',
  nip: '1990133136',
  email: 'owe-yeah@osieka.dev',
} as const;
