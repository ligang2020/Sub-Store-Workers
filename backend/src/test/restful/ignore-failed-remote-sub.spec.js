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

    it('keeps an explicitly disabled setting strict', function () {
        expect(resolveIgnoreFailedRemoteSubMode(false)).to.equal('disabled');
    });
});
