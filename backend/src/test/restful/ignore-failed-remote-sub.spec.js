import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
    resolveIgnoreFailedRemoteSubMode,
    shouldFallbackIgnoreFailedRemoteSub,
} from '@/restful/ignore-failed-remote-sub';

describe('remote subscription failure mode', function () {
    it('uses a quiet fallback for legacy subscriptions without a setting', function () {
        const mode = resolveIgnoreFailedRemoteSubMode(undefined, '');

        expect(mode).to.equal('fallbackQuiet');
        expect(shouldFallbackIgnoreFailedRemoteSub(mode)).to.equal(true);
    });

    it('uses a quiet fallback for legacy subscriptions that persisted false', function () {
        expect(resolveIgnoreFailedRemoteSubMode(false)).to.equal('fallbackQuiet');
    });

    it('keeps the explicit disabled mode strict', function () {
        expect(resolveIgnoreFailedRemoteSubMode('disabled')).to.equal('disabled');
    });
});
