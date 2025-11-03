# Phase 2: Integration Tests - Implementation Plan

**Status:** 🚀 Starting
**Goal:** Convert mock-heavy tests to integration tests using real APIs
**Duration:** 2 weeks
**Target:** 20-30 integration tests with real service interactions

---

## Executive Summary

Phase 2 builds on Phase 1's contract test foundation by testing how our services **actually work together** with real external APIs. This addresses the critical finding from our testing analysis:

> **Current State:** 54% of tests are "testing theater" - validating mocks instead of real behavior

**Key Transformation:**
- AudioEnrichmentService: 20% real logic → 80% real logic tested
- LastFmService: 40% real logic → 80% real logic tested
- Full pipeline: 0% integration coverage → 100% integration coverage

---

## Phase 2 Objectives

### Primary Goals:
1. ✅ Test services with **real external APIs** (no mocks)
2. ✅ Validate **caching behavior** with real KV store
3. ✅ Verify **rate limiting** under real load
4. ✅ Test **error handling** with real API errors
5. ✅ Validate **data flows** through entire pipeline

### Success Metrics:
- 20-30 integration tests created
- All tests use real APIs (no mocking external services)
- Caching verified with real KV operations
- Rate limiting validated with timing assertions
- Full enrichment pipeline tested end-to-end

---

## Work Breakdown

### Agent 1: Integration Test Infrastructure
**Estimated Time:** 2 hours
**Priority:** HIGH (blocks other agents)

**Tasks:**
1. Create `workers/api/vitest.integration.config.ts`
   - Extended timeout (60s for API calls)
   - Sequential execution (respect rate limits)
   - Use node environment
   - Match only `**/*.integration.test.ts`

2. Create `workers/api/src/__tests__/helpers/integration-setup.ts`
   - Mock KV namespace implementation (in-memory for testing)
   - Environment setup utilities
   - Credential validation
   - Test data builders for tracks

3. Create `workers/api/src/__tests__/integration/README.md`
   - What integration tests are
   - How to run locally
   - Required credentials
   - Best practices

4. Update package scripts
   - `test:integration` - Run all integration tests
   - `test:integration:watch` - Watch mode
   - Add to root package.json

**Deliverables:**
- ✅ Integration test config
- ✅ Setup utilities
- ✅ Documentation
- ✅ Package scripts

---

### Agent 2: AudioEnrichmentService Integration Tests
**Estimated Time:** 3 hours
**Priority:** HIGH
**Depends On:** Agent 1 (infrastructure)

**Tasks:**
1. Create `workers/api/src/__tests__/integration/AudioEnrichmentService.integration.test.ts`

**Test Scenarios:**
1. **Single Track Enrichment (Deezer ISRC lookup)**
   - Use real track with known ISRC (Bohemian Rhapsody)
   - Verify BPM in valid range (45-220)
   - Verify rank, gain, release_date fields
   - Test that result is cached in KV

2. **Batch Track Enrichment (10 tracks)**
   - Test rate limiting (40 TPS)
   - Verify all tracks processed
   - Measure execution time
   - Verify cache population

3. **Cache Hit Performance**
   - Enrich same tracks twice
   - Second run should be much faster (cache hits)
   - Verify no API calls on cache hit

4. **MusicBrainz Fallback**
   - Test track without ISRC in Spotify
   - Verify fallback to MusicBrainz ISRC lookup
   - Verify Deezer enrichment still works

5. **Error Handling**
   - Test track with invalid ISRC
   - Test track not in Deezer catalog
   - Verify graceful null returns

6. **BPM Validation**
   - Test BPM range enforcement
   - Test null BPM handling (Deezer data incomplete)

**Expected Tests:** 8-10 integration tests

**Key Assertions:**
- Real BPM values from Deezer
- Rate limiting respected (timing checks)
- Cache working (KV get/set verified)
- Error handling graceful

---

### Agent 3: LastFmService Integration Tests
**Estimated Time:** 3 hours
**Priority:** HIGH
**Depends On:** Agent 1 (infrastructure)

**Tasks:**
1. Create `workers/api/src/__tests__/integration/LastFmService.integration.test.ts`

**Test Scenarios:**
1. **Single Track Signals (track.getInfo)**
   - Use real track (Bohemian Rhapsody)
   - Verify listeners > 1,000,000
   - Verify top tags returned (array length > 0)
   - Verify album metadata
   - Test cache population

2. **Artist Info Fetching**
   - Test separate artist info fetch
   - Verify bio, tags, similar artists
   - Test deduplication (don't fetch same artist twice)

3. **Batch Track Signals (50 tracks)**
   - Test rate limiting (5 TPS for Last.fm)
   - Verify all tracks processed
   - Measure execution time
   - Verify cache hits

4. **Tag Aggregation**
   - Enrich multiple tracks
   - Call aggregateTags()
   - Verify tag counts
   - Verify deduplication

5. **Popularity Calculation**
   - Enrich multiple tracks
   - Call calculateAveragePopularity()
   - Verify average listeners/playcounts

6. **Track Correction (autocorrect)**
   - Test misspelled track name
   - Verify autocorrect works
   - Verify canonical name returned

7. **Error Handling**
   - Test track not in Last.fm
   - Test invalid artist name
   - Verify graceful null returns

8. **Cache Behavior**
   - Verify 7-day TTL
   - Verify cache key format
   - Test cache hits on second enrichment

**Expected Tests:** 10-12 integration tests

**Key Assertions:**
- Real crowd-sourced data from Last.fm
- Rate limiting (200ms between calls)
- Artist deduplication working
- Tag aggregation accurate
- Cache working with correct TTL

---

### Agent 4: Full Pipeline Integration Tests
**Estimated Time:** 4 hours
**Priority:** MEDIUM
**Depends On:** Agent 1, 2, 3

**Tasks:**
1. Create `workers/api/src/__tests__/integration/enrichment-pipeline.integration.test.ts`

**Test Scenarios:**
1. **Single Track End-to-End**
   - Start with Spotify track object
   - Enrich with Deezer (BPM, rank, gain)
   - Enrich with Last.fm (tags, popularity)
   - Verify both enrichments work together
   - Verify both cached

2. **Batch Pipeline (20 tracks)**
   - Fetch tracks from Spotify API (optional, can use mocked Spotify tracks)
   - Enrich all with Deezer
   - Enrich all with Last.fm
   - Aggregate results
   - Verify complete analysis object

3. **Full Playlist Analysis Simulation**
   - Simulate the analyze_playlist tool flow
   - Calculate metadata analysis
   - Run Deezer enrichment (up to 100 tracks)
   - Run Last.fm enrichment (up to 50 tracks)
   - Aggregate tags and popularity
   - Verify complete analysis matches expected format

4. **Cache Efficiency**
   - Enrich playlist twice
   - Verify second run much faster
   - Verify no duplicate API calls

5. **Rate Limiting Coordination**
   - Enrich large batch (50+ tracks)
   - Verify Deezer rate limit respected (40 TPS)
   - Verify Last.fm rate limit respected (5 TPS)
   - Verify RateLimitedQueue working correctly

6. **Error Recovery**
   - Mix tracks that exist and don't exist in Deezer
   - Mix tracks that exist and don't exist in Last.fm
   - Verify partial results returned
   - Verify errors don't crash pipeline

7. **Artist Info Integration**
   - Enrich tracks with Last.fm
   - Verify unique artists fetched separately
   - Verify artist info attached to track signals
   - Verify cache updated with artist info

**Expected Tests:** 8-10 integration tests

**Key Assertions:**
- Full pipeline completes successfully
- All rate limits respected
- Caching reduces API calls on second run
- Partial failures handled gracefully
- Final analysis object matches schema

---

### Agent 5: Documentation & Scripts
**Estimated Time:** 1 hour
**Priority:** LOW
**Depends On:** Agent 1, 2, 3, 4

**Tasks:**
1. Update `TESTING_IMPROVEMENT_PLAN.md`
   - Mark Phase 2 as complete
   - Add actual results

2. Create `TESTING_PHASE2_COMPLETE.md`
   - Summary of integration tests created
   - Test results
   - Value delivered
   - Next steps (Phase 3)

3. Update root README if needed
   - Add integration test commands
   - Document required credentials

4. Create `.github/workflows/integration-tests.yml` (optional)
   - Run on merge to main
   - Use GitHub Secrets for API keys
   - Fail if tests don't pass

**Deliverables:**
- ✅ Phase 2 completion report
- ✅ Updated documentation
- ✅ Optional CI/CD workflow

---

## Implementation Strategy

### Parallel Execution Plan:

**Wave 1 (Can start immediately):**
- Agent 1: Integration test infrastructure

**Wave 2 (Start after Agent 1 completes infrastructure):**
- Agent 2: AudioEnrichmentService integration tests
- Agent 3: LastFmService integration tests

**Wave 3 (Start after Wave 2 completes):**
- Agent 4: Full pipeline integration tests

**Wave 4 (Start after Wave 3 completes):**
- Agent 5: Documentation & completion report

### Why Sequential for Integration Tests:
Unlike contract tests which are independent, integration tests:
1. Need common infrastructure (Agent 1 creates this)
2. May share test utilities
3. Build on each other (pipeline tests use service tests' patterns)

---

## Required Credentials

Same as contract tests:
- `SPOTIFY_ACCESS_TOKEN` (optional - can use mock Spotify data)
- `LASTFM_API_KEY` (required for Last.fm integration tests)
- No Deezer credentials needed (public API)

Integration tests will skip gracefully if credentials missing.

---

## Test Approach Differences

### Contract Tests (Phase 1):
- ✅ Validate API response schemas
- ✅ Detect breaking API changes
- ✅ Run nightly in CI

### Integration Tests (Phase 2):
- ✅ Validate services work together
- ✅ Test caching, rate limiting, error handling
- ✅ Use real APIs, real KV, real timing
- ✅ Run on merge to main (slower)

### Unit Tests (Existing):
- ⚠️ Validate individual function logic
- ⚠️ Use mocks extensively (testing theater)
- ⚠️ Run on every commit (fast)

---

## Success Criteria

### Quantitative:
- [ ] 20-30 integration tests created
- [ ] All tests pass with real API credentials
- [ ] Tests skip gracefully without credentials
- [ ] Execution time: 30-60 seconds (with rate limiting)
- [ ] 0 mocked external APIs (use real Deezer, Last.fm)

### Qualitative:
- [ ] Tests validate real service interactions
- [ ] Caching behavior verified with real KV
- [ ] Rate limiting verified with timing assertions
- [ ] Error handling tested with real API errors
- [ ] Pipeline integration validated end-to-end

### Coverage Goals:
- AudioEnrichmentService: 20% → 80% real logic tested
- LastFmService: 40% → 80% real logic tested
- Full pipeline: 0% → 100% integration coverage

---

## Risk Mitigation

### Risk 1: API Rate Limits
**Mitigation:**
- Use rate limiting in tests
- Cache aggressively
- Skip tests if rate limit exceeded

### Risk 2: Slow Test Execution
**Mitigation:**
- Run integration tests only on merge (not every commit)
- Use response caching
- Run subset of tests in CI, full suite manually

### Risk 3: Flaky Tests (Network Issues)
**Mitigation:**
- Retry failed tests once
- Use well-known stable test data
- Set generous timeouts (60s)

### Risk 4: API Credentials Management
**Mitigation:**
- Use GitHub Secrets in CI
- Skip tests gracefully when missing
- Document how to get credentials

---

## Timeline

### Week 1:
- Day 1-2: Agent 1 (Infrastructure)
- Day 3-4: Agent 2 & 3 (Service integration tests)
- Day 5: Agent 4 (Pipeline tests, part 1)

### Week 2:
- Day 1-2: Agent 4 (Pipeline tests, part 2)
- Day 3: Agent 5 (Documentation)
- Day 4-5: Testing, refinement, CI/CD setup

**Total Estimated Time:** 10 work days (2 weeks)

---

## Next Steps After Phase 2

**Phase 3: E2E Tests (Weeks 4-6)**
- Playwright browser automation
- Golden path: Analyze playlist workflow
- Golden path: Create playlist workflow
- OAuth flow testing
- Error recovery scenarios

**Goal:** 10-15 E2E tests validating complete user journeys

---

## Key Deliverables Summary

### Files to Create (Minimum):
1. `workers/api/vitest.integration.config.ts` - Config
2. `workers/api/src/__tests__/helpers/integration-setup.ts` - Utilities
3. `workers/api/src/__tests__/integration/README.md` - Docs
4. `workers/api/src/__tests__/integration/AudioEnrichmentService.integration.test.ts` - 8-10 tests
5. `workers/api/src/__tests__/integration/LastFmService.integration.test.ts` - 10-12 tests
6. `workers/api/src/__tests__/integration/enrichment-pipeline.integration.test.ts` - 8-10 tests
7. `TESTING_PHASE2_COMPLETE.md` - Completion report
8. Updated `package.json` - Integration test scripts

**Total:** 8 files, 26-32 integration tests

---

## Value Proposition

**Investment:** 2 weeks (10 work days)

**Return:**
- ✅ Catch integration bugs before production
- ✅ Validate caching actually works
- ✅ Verify rate limiting under real load
- ✅ Test error handling with real errors
- ✅ Confidence to refactor services
- ✅ Move from 54% testing theater → real value

**Break-Even:** First integration bug caught = ROI positive

**Expected:** Catch 2-3 integration bugs per quarter (est. 8-12 dev hours saved)

---

## Alignment with Testing Philosophy

From TESTING_GUIDANCE.md:

### Core Principle: "Test Real Behavior, Not Mocks" ✅

Integration tests embody this by:
- Using real external APIs (Deezer, Last.fm)
- Testing with real KV cache
- Validating real rate limiting behavior
- Testing real error conditions

### Value Hierarchy: ⭐⭐⭐⭐⭐ (CRITICAL)

Integration tests rated CRITICAL because they:
1. **Catch integration failures** between services
2. **Validate caching** actually works in practice
3. **Test rate limiting** under real conditions
4. **Verify error handling** with real API errors
5. **Build confidence** for refactoring

---

**Phase 2 Status:** 🚀 Ready to Start
**Estimated Completion:** 2 weeks from start
**Prerequisites:** Phase 1 complete ✅
**Next Phase:** Phase 3 (E2E Tests)
