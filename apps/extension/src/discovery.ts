import browser from 'webextension-polyfill';
import { extractRendered } from './navigation/discovery/extract';
void extractRendered(document).then((result) =>
  browser.runtime.sendMessage({ type: 'discovery_page_result', result }),
);
