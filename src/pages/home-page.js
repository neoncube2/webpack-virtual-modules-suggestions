import { getTopLevelDomain } from '../util';

import Logo from '../logo.svg';

const dynamicallyLoaded = import('./dynamically-loaded.js');

console.log(getTopLevelDomain);
console.log(Logo);
console.log(dynamicallyLoaded);

export default 'home-page';