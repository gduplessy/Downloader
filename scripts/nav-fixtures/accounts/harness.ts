import {supportedForm,fillOnce} from '../../../apps/extension/src/navigation/accounts/forms';
import {accountDecision,readSignals} from '../../../apps/extension/src/navigation/accounts/policy';
import {showAccountPanel} from '../../../apps/extension/src/navigation/accounts/panel';
import {collectControls} from '../../../apps/extension/src/navigation/adapters/dom';
import {inspectCandidates} from '../../../apps/extension/src/navigation/adapters/policy';
Object.assign(window,{navAccounts:{supportedForm,fillOnce,accountDecision,readSignals,showAccountPanel,collectControls,inspectCandidates}});
