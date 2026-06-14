// =====================================================
// FEEDBACK INTELLIGENCE ENGINE
// Scores, tags, and prioritises learner feedback
// =====================================================

window.FeedbackIntel = {

    // ── Keyword dictionaries ──
    NEGATIVE_KEYWORDS: [
        'confusing', 'confused', 'difficult', 'wrong', 'error', 'missing',
        'unclear', 'improve', 'frustrating', 'boring', 'slow', 'bad',
        'poor', 'terrible', 'awful', 'disappointed', 'disappointing',
        'waste', 'useless', 'outdated', 'broken', 'fail', 'failed',
        'hard to', 'not working', 'doesn\'t work', 'didn\'t work',
        'too long', 'too short', 'not enough', 'incomplete', 'inaccurate',
        'repetitive', 'redundant', 'irrelevant', 'not helpful', 'unhelpful',
        'disorganized', 'disorganised', 'complicated', 'overwhelming'
    ],

    POSITIVE_KEYWORDS: [
        'excellent', 'amazing', 'fantastic', 'wonderful', 'outstanding',
        'helpful', 'loved', 'love', 'great', 'best', 'learned', 'learnt',
        'practical', 'recommend', 'informative', 'engaging', 'clear',
        'well structured', 'well organized', 'well organised', 'thorough',
        'comprehensive', 'valuable', 'useful', 'insightful', 'inspiring',
        'professional', 'high quality', 'well done', 'thank you', 'thanks',
        'appreciate', 'enjoyed', 'enjoy'
    ],

    SUGGESTION_KEYWORDS: [
        'should', 'could', 'would be better', 'suggestion', 'suggest',
        'please add', 'i wish', 'it would be', 'would like', 'consider',
        'recommend adding', 'needs more', 'would benefit', 'opportunity to',
        'would improve', 'might be', 'perhaps', 'how about', 'why not',
        'instead of', 'rather than', 'alternative'
    ],

    // Topic categories and their trigger words
    TOPIC_TAGS: {
        'Content Quality': ['video', 'audio', 'quality', 'content', 'material', 'slides', 'presentation', 'image', 'images', 'resolution', 'recording'],
        'Assessment': ['quiz', 'quizzes', 'test', 'exam', 'assessment', 'question', 'questions', 'answer', 'answers', 'score', 'pass', 'fail', 'grade'],
        'Platform / UX': ['navigate', 'navigation', 'find', 'login', 'log in', 'sign in', 'access', 'download', 'loading', 'slow', 'bug', 'glitch', 'interface', 'website', 'platform', 'app', 'mobile', 'phone'],
        'Certification': ['certificate', 'credential', 'accreditation', 'cme', 'cpd', 'credit', 'credits', 'diploma'],
        'Teaching': ['instructor', 'teacher', 'tutor', 'lecturer', 'facilitator', 'mentor', 'faculty', 'speaker', 'expert'],
        'Practical Skills': ['practical', 'hands-on', 'hands on', 'clinical', 'surgical', 'technique', 'skill', 'skills', 'simulation', 'cadaver', 'workshop', 'lab'],
        'Duration / Pacing': ['too long', 'too short', 'pace', 'pacing', 'duration', 'length', 'time', 'hours', 'rushed', 'slow'],
        'Language': ['language', 'translation', 'translate', 'english', 'french', 'spanish', 'subtitle', 'subtitles']
    },

    // ── Core scoring function ──
    scoreFeedback(entry) {
        const text = (entry.t || '').toLowerCase();
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;
        let score = 0;
        let flags = [];

        // 1. Length scoring
        if (wordCount >= 50) { score += 3; flags.push('detailed'); }
        else if (wordCount >= 30) { score += 2; flags.push('detailed'); }
        else if (wordCount < 5) { score -= 2; }

        // 2. Negative / constructive keyword scoring
        const negHits = this.NEGATIVE_KEYWORDS.filter(kw => text.includes(kw));
        if (negHits.length >= 2) { score += 3; flags.push('critical'); }
        else if (negHits.length === 1) { score += 2; flags.push('critical'); }

        // 3. Suggestion keywords
        const sugHits = this.SUGGESTION_KEYWORDS.filter(kw => text.includes(kw));
        if (sugHits.length > 0) { score += 2; flags.push('suggestion'); }

        // 4. Question detection
        if (text.includes('?')) { score += 1; flags.push('question'); }

        // 5. Low rating boost (critical feedback with low ratings is important)
        if (entry.r > 0 && entry.r < 3) { score += 2; }
        else if (entry.r >= 4) { score -= 1; } // slightly lower priority for already-happy users

        // 6. Topic tagging
        let topics = [];
        for (const [topic, keywords] of Object.entries(this.TOPIC_TAGS)) {
            if (keywords.some(kw => text.includes(kw))) {
                topics.push(topic);
            }
        }

        // 7. Positive keyword count (for summary stats, not for deprioritizing)
        const posHits = this.POSITIVE_KEYWORDS.filter(kw => text.includes(kw));

        // 8. Testimonial detection: positive sentiment + substantial length + positive keywords
        let testimonialScore = 0;
        if (entry.s === 'Positive' || (entry.r && entry.r >= 4)) testimonialScore += 2;
        if (posHits.length >= 2) testimonialScore += 2;
        else if (posHits.length === 1) testimonialScore += 1;
        if (wordCount >= 30) testimonialScore += 3;
        else if (wordCount >= 20) testimonialScore += 2;
        else if (wordCount >= 10) testimonialScore += 1;
        if (negHits.length === 0) testimonialScore += 1; // no negativity
        const isTestimonial = testimonialScore >= 5;
        if (isTestimonial) flags.push('testimonial');

        // Determine priority level
        let priority = 'low';
        if (score >= 5) priority = 'high';
        else if (score >= 2) priority = 'medium';

        return {
            ...entry,
            _score: score,
            _priority: priority,
            _flags: flags,
            _topics: topics,
            _wordCount: wordCount,
            _negHits: negHits,
            _posHits: posHits,
            _sugHits: sugHits,
            _testimonialScore: testimonialScore
        };
    },

    // ── Process an entire feedback bank ──
    analyzeBank(bank) {
        if (!bank || bank.length === 0) return { scored: [], stats: {} };

        const scored = bank
            .filter(b => b.t && !b.t.match(/^no\s*data$/i) && b.t.trim().length > 0)
            .map(b => this.scoreFeedback(b));

        // Aggregate stats
        const stats = {
            total: scored.length,
            high: scored.filter(s => s._priority === 'high').length,
            medium: scored.filter(s => s._priority === 'medium').length,
            low: scored.filter(s => s._priority === 'low').length,
            withSuggestions: scored.filter(s => s._flags.includes('suggestion')).length,
            withQuestions: scored.filter(s => s._flags.includes('question')).length,
            detailed: scored.filter(s => s._flags.includes('detailed')).length,
            critical: scored.filter(s => s._flags.includes('critical')).length,
            testimonials: scored.filter(s => s._flags.includes('testimonial')).length,
            topicCounts: {},
            sentimentBreakdown: {
                Positive: scored.filter(s => s.s === 'Positive').length,
                Critical: scored.filter(s => s.s === 'Critical').length,
                Neutral: scored.filter(s => s.s === 'Neutral').length
            }
        };

        // Count topics
        for (const s of scored) {
            for (const t of s._topics) {
                stats.topicCounts[t] = (stats.topicCounts[t] || 0) + 1;
            }
        }

        return { scored, stats };
    },

    // ── Theme detection: find recurring phrases ──
    detectThemes(scored, minOccurrences = 3) {
        // Extract 2-3 word phrases (bigrams/trigrams) from all feedback
        const phraseCounts = {};
        const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','is','it','was','were','are','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','can','i','we','you','they','he','she','this','that','with','from','my','your','our','very','really','also','just','more','most','some','any','all','each','every','not','no','so','as','if','than','then','too']);

        for (const entry of scored) {
            const words = (entry.t || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
            // Bigrams
            for (let i = 0; i < words.length - 1; i++) {
                const phrase = words[i] + ' ' + words[i + 1];
                phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
            }
        }

        return Object.entries(phraseCounts)
            .filter(([_, count]) => count >= minOccurrences)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([phrase, count]) => ({ phrase, count }));
    },

    // ── Word Cloud builder: returns array of { word, count, size, color, opacity, sentimentLabel } ──
    buildWordCloud(bank, maxWords) {
        maxWords = maxWords || 60;
        if (!bank || bank.length === 0) return [];

        const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','is','it','its','was','were','are','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','can','i','we','you','they','he','she','this','that','with','from','my','your','our','very','really','also','just','more','most','some','any','all','each','every','not','no','so','as','if','than','then','too','about','up','out','what','which','who','how','when','where','there','here','them','their','these','those','been','much','many','such','own','other','only','after','before','into','over','new','way','well','even','back','work','take','get','got','go','went','made','make','said','like','know','good','time','one','two','first','last','long','great','high','old','big','little','different','small','used','need','help','course','nan','data','per']);

        // Count word frequency with sentiment tracking
        const wordStats = {};
        const filtered = bank.filter(b => b.t && !b.t.match(/^no\s*data$/i) && b.t.trim().length > 0);

        filtered.forEach(entry => {
            const words = (entry.t || '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
            const seen = new Set(); // count each word once per entry
            words.forEach(w => {
                if (seen.has(w)) return;
                seen.add(w);
                if (!wordStats[w]) wordStats[w] = { count: 0, posCount: 0, negCount: 0, neuCount: 0 };
                wordStats[w].count++;
                if (entry.s === 'Positive') wordStats[w].posCount++;
                else if (entry.s === 'Critical') wordStats[w].negCount++;
                else wordStats[w].neuCount++;
            });
        });

        // Sort by frequency and take top N
        const sorted = Object.entries(wordStats)
            .filter(([_, s]) => s.count >= 2)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, maxWords);

        if (sorted.length === 0) return [];

        const maxCount = sorted[0][1].count;
        const minCount = sorted[sorted.length - 1][1].count;

        return sorted.map(([word, stats]) => {
            // Size: 12px to 36px based on frequency
            const norm = maxCount === minCount ? 0.5 : (stats.count - minCount) / (maxCount - minCount);
            const size = Math.round(12 + norm * 24);

            // Color based on dominant sentiment
            const total = stats.posCount + stats.negCount + stats.neuCount;
            const posRatio = stats.posCount / total;
            const negRatio = stats.negCount / total;
            let color, sentimentLabel;
            if (negRatio > 0.5) { color = '#dc2626'; sentimentLabel = 'mostly critical'; }
            else if (negRatio > 0.3) { color = '#ea580c'; sentimentLabel = 'mixed negative'; }
            else if (posRatio > 0.6) { color = '#16a34a'; sentimentLabel = 'mostly positive'; }
            else if (posRatio > 0.4) { color = '#65a30d'; sentimentLabel = 'leaning positive'; }
            else { color = '#64748b'; sentimentLabel = 'neutral'; }

            const opacity = 0.6 + norm * 0.4;

            return { word, count: stats.count, size, color, opacity: opacity.toFixed(2), sentimentLabel };
        });
    },

    // ── Platform-level keywords (strong = very likely platform-level, weak = needs additional signal) ──
    PLATFORM_KEYWORDS_STRONG: [
        'surghub', 'surg hub', 'learnworlds', 'learn worlds',
        'the platform', 'this platform', 'your platform',
        'the website', 'this website', 'the site', 'this site',
        'the portal', 'this portal',
        'overall experience', 'overall programme', 'overall program',
        'in general', 'as a whole', 'keep up', 'keep it up',
        'this initiative', 'the initiative', 'this program', 'the program',
        'this project', 'the project',
        'global surgery foundation', 'gsf platform',
        'online learning platform', 'e-learning platform',
        'user experience', 'user interface',
        'certificate download', 'login issue', 'sign up process',
        'more courses', 'more topics', 'wider range',
        'surgical education', 'continuing education'
    ],

    PLATFORM_KEYWORDS_WEAK: [
        'platform', 'website', 'online', 'app', 'interface',
        'navigation', 'navigate', 'mobile', 'login', 'log in',
        'sign up', 'registration', 'account', 'notification',
        'email', 'accessibility', 'layout', 'design', 'gsf'
    ],

    // ── Extract platform-level feedback from all courses ──
    extractPlatformFeedback(allCourses) {
        let allFeedback = [];

        for (const course of allCourses) {
            if (!course.FeedbackBank) continue;
            try {
                const bank = JSON.parse(course.FeedbackBank);
                if (!Array.isArray(bank)) continue;
                for (const entry of bank) {
                    if (!entry.t || entry.t.trim().length === 0) continue;
                    allFeedback.push({
                        ...entry,
                        _course: course.Course || 'Unknown',
                        _provider: course.Provider || 'Unknown'
                    });
                }
            } catch (e) {}
        }

        // Score all feedback
        const scored = allFeedback
            .filter(b => b.t && !b.t.match(/^no\s*data$/i) && b.t.trim().length > 0)
            .map(b => this.scoreFeedback(b));

        // ── Platform relevance scoring ──
        // Each entry gets a platform relevance score. Higher = more likely about the platform.
        const platformScored = scored.map(entry => {
            const text = (entry.t || '').toLowerCase();
            let platScore = 0;

            // Strong keyword match = high confidence
            const strongHits = this.PLATFORM_KEYWORDS_STRONG.filter(kw => text.includes(kw));
            platScore += strongHits.length * 3;

            // Weak keyword match = needs additional signal
            const weakHits = this.PLATFORM_KEYWORDS_WEAK.filter(kw => text.includes(kw));
            platScore += weakHits.length * 1;

            // "Additional comments" column type is much more likely to be platform-level
            if (entry.c === 'additional') platScore += 4;

            // Longer feedback from "additional" fields is even more valuable
            if (entry.c === 'additional' && entry._wordCount >= 15) platScore += 2;

            // "Improve" column with platform keywords = platform improvement feedback
            if (entry.c === 'improve' && weakHits.length > 0) platScore += 2;

            // Penalise very course-specific language (likely about the course, not the platform)
            const courseSpecific = ['this course', 'the course', 'this module', 'the module',
                'the lecture', 'this lecture', 'the instructor', 'the teacher', 'the quiz',
                'the exam', 'the video', 'this video', 'the slides'];
            const courseHits = courseSpecific.filter(kw => text.includes(kw));
            platScore -= courseHits.length * 2;

            return { ...entry, _platScore: platScore, _strongHits: strongHits, _weakHits: weakHits };
        });

        // Filter: require minimum platform relevance score
        // - Strong keyword alone (score 3+) = included
        // - "Additional comments" alone (score 4+) = included
        // - Weak keyword from non-additional column (score 1) = excluded (too noisy)
        const platformRelevant = platformScored
            .filter(entry => entry._platScore >= 3)
            .sort((a, b) => b._platScore - a._platScore || b._score - a._score);

        // Also get top testimonials across all courses (even if not platform-specific)
        const allTestimonials = scored
            .filter(s => s._flags.includes('testimonial'))
            .sort((a, b) => b._testimonialScore - a._testimonialScore)
            .slice(0, 20);

        // Stats for platform feedback
        const platformStats = {
            total: platformRelevant.length,
            high: platformRelevant.filter(s => s._priority === 'high').length,
            medium: platformRelevant.filter(s => s._priority === 'medium').length,
            low: platformRelevant.filter(s => s._priority === 'low').length,
            withSuggestions: platformRelevant.filter(s => s._flags.includes('suggestion')).length,
            withQuestions: platformRelevant.filter(s => s._flags.includes('question')).length,
            detailed: platformRelevant.filter(s => s._flags.includes('detailed')).length,
            critical: platformRelevant.filter(s => s._flags.includes('critical')).length,
            testimonials: platformRelevant.filter(s => s._flags.includes('testimonial')).length,
            topicCounts: {},
            sentimentBreakdown: {
                Positive: platformRelevant.filter(s => s.s === 'Positive').length,
                Critical: platformRelevant.filter(s => s.s === 'Critical').length,
                Neutral: platformRelevant.filter(s => s.s === 'Neutral').length
            }
        };

        for (const s of platformRelevant) {
            for (const t of s._topics) {
                platformStats.topicCounts[t] = (platformStats.topicCounts[t] || 0) + 1;
            }
        }

        return {
            platformFeedback: platformRelevant,
            platformStats,
            allTestimonials,
            totalFeedbackCount: scored.length
        };
    }
};
