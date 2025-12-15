// KPI Analysis Module
import { _supabase } from './config.js';

/**
 * Fair KPI Recommendation System
 *
 * This system uses a team-average based approach:
 * 1. Calculates team-wide average weekly score
 * 2. Compares each user to the team average
 * 3. Sets personalized growth targets based on distance from average
 * 4. Lower performers get smaller, achievable growth targets
 * 5. Higher performers get challenging targets to maintain excellence
 */

/**
 * Generate comprehensive KPI analysis for the team
 */
export async function generateKPIAnalysis() {
    const startDateInput = document.getElementById('kpi-analysis-start-date');
    const endDateInput = document.getElementById('kpi-analysis-end-date');
    const resultsDiv = document.getElementById('kpi-analysis-results');

    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!startDate || !endDate) {
        resultsDiv.innerHTML = '<p class="text-red-400 text-sm">Please select both start and end dates.</p>';
        return;
    }

    resultsDiv.innerHTML = '<p class="text-indigo-400 text-sm">Analyzing data...</p>';

    try {
        // Fetch weekly scores for the period
        const { data: weeklyScores, error } = await _supabase
            .from('weekly_leaderboard')
            .select('*')
            .gte('week_start_date', startDate)
            .lte('week_start_date', endDate)
            .order('week_start_date', { ascending: true });

        if (error) throw error;

        if (!weeklyScores || weeklyScores.length === 0) {
            resultsDiv.innerHTML = '<p class="text-yellow-400 text-sm">No data found for the selected period.</p>';
            return;
        }

        // Process the data
        const analysis = analyzePerformanceData(weeklyScores, startDate, endDate);

        // Display the results
        displayKPIAnalysis(analysis, resultsDiv);

        // Store for export
        window.currentKPIAnalysis = analysis;

    } catch (error) {
        console.error('Error generating KPI analysis:', error);
        resultsDiv.innerHTML = `<p class="text-red-400 text-sm">Error: ${error.message}</p>`;
    }
}

/**
 * Analyze performance data and calculate statistics
 */
function analyzePerformanceData(weeklyScores, startDate, endDate) {
    // Group by user and week
    const userWeeklyData = {};

    weeklyScores.forEach(record => {
        if (!userWeeklyData[record.username]) {
            userWeeklyData[record.username] = {
                username: record.username,
                weeks: [],
                totalPoints: 0
            };
        }
        userWeeklyData[record.username].weeks.push({
            weekStart: record.week_start_date,
            points: record.total_score
        });
        userWeeklyData[record.username].totalPoints += record.total_score;
    });

    // Calculate statistics for each user
    const userStats = Object.keys(userWeeklyData).map(username => {
        const userData = userWeeklyData[username];
        const weeklyPoints = userData.weeks.map(w => w.points);

        return {
            username: userData.username,
            weekCount: weeklyPoints.length,
            totalPoints: userData.totalPoints,
            averageWeekly: userData.totalPoints / weeklyPoints.length,
            medianWeekly: calculateMedian(weeklyPoints),
            minWeekly: Math.min(...weeklyPoints),
            maxWeekly: Math.max(...weeklyPoints),
            stdDev: calculateStdDev(weeklyPoints),
            weeklyData: userData.weeks
        };
    });

    // Sort by average weekly score
    userStats.sort((a, b) => b.averageWeekly - a.averageWeekly);

    // Calculate team-wide statistics
    const allWeeklyAverages = userStats.map(u => u.averageWeekly);
    const teamMedian = calculateMedian(allWeeklyAverages);
    const teamAverage = allWeeklyAverages.reduce((sum, val) => sum + val, 0) / allWeeklyAverages.length;
    const teamStdDev = calculateStdDev(allWeeklyAverages);

    // Calculate percentiles
    const p25 = calculatePercentile(allWeeklyAverages, 25);
    const p50 = teamMedian;
    const p75 = calculatePercentile(allWeeklyAverages, 75);
    const p90 = calculatePercentile(allWeeklyAverages, 90);

    // Generate KPI recommendations for each user
    const kpiRecommendations = userStats.map(user => generateKPIRecommendation(user, {
        teamMedian,
        teamAverage,
        p25,
        p50,
        p75,
        p90
    }));

    return {
        startDate,
        endDate,
        userStats,
        kpiRecommendations,
        teamStats: {
            median: teamMedian,
            average: teamAverage,
            stdDev: teamStdDev,
            p25,
            p50,
            p75,
            p90,
            totalUsers: userStats.length
        }
    };
}

/**
 * Generate fair KPI recommendation for a user
 *
 * New Fairness Strategy (Team Average Based with Bonus Support):
 * - Far Below Average (< 70% of team avg): Current + 25% bonus
 * - Below Average (70-90% of team avg): Current + 15% bonus
 * - At Average (90-110% of team avg): No bonus
 * - Above Average (110-125% of team avg): No bonus
 * - Top Performers (>= 125% of team avg): No bonus (already excellent)
 */
function generateKPIRecommendation(user, teamStats) {
    const { averageWeekly } = user;
    const { teamAverage } = teamStats;

    let tier, targetKPI, reasoning, bonusPercentage;
    const percentOfTeamAvg = (averageWeekly / teamAverage) * 100;

    if (percentOfTeamAvg < 70) {
        // Far below average - extra support bonus
        tier = 'Needs Support';
        bonusPercentage = 25;
        targetKPI = Math.round(averageWeekly * 1.25);
        reasoning = `Currently at ${Math.round(percentOfTeamAvg)}% of team average. KPI = Current + 25% bonus support (${targetKPI}).`;
    } else if (percentOfTeamAvg < 90) {
        // Below average - support bonus
        tier = 'Developing';
        bonusPercentage = 15;
        targetKPI = Math.round(averageWeekly * 1.15);
        reasoning = `Currently at ${Math.round(percentOfTeamAvg)}% of team average. KPI = Current + 15% bonus support (${targetKPI}).`;
    } else if (percentOfTeamAvg < 110) {
        // At average - no bonus
        tier = 'Proficient';
        bonusPercentage = 0;
        targetKPI = Math.round(averageWeekly);
        reasoning = `Currently at team average level. KPI = Current level maintained (${targetKPI}).`;
    } else if (percentOfTeamAvg < 125) {
        // Above average - no bonus
        tier = 'Advanced';
        bonusPercentage = 0;
        targetKPI = Math.round(averageWeekly);
        reasoning = `Above team average. KPI = Current level maintained (${targetKPI}).`;
    } else {
        // Top performers - no bonus
        tier = 'Expert';
        bonusPercentage = 0;
        targetKPI = Math.round(averageWeekly);
        reasoning = `Top performer at ${Math.round(percentOfTeamAvg)}% of team average. KPI = Current level maintained (${targetKPI}).`;
    }

    // Calculate KPI out of 5 based on target score
    // KPI = (targetKPI / teamAverage) * 3 - team average performers get ~3/5
    const kpiOutOf5 = Math.min(5, Math.max(1, Math.round((targetKPI / teamAverage) * 3)));

    return {
        ...user,
        tier,
        targetKPI,
        bonusPercentage,
        reasoning,
        percentOfTeamAvg: Math.round(percentOfTeamAvg),
        currentVsTarget: targetKPI - Math.round(averageWeekly),
        kpiOutOf5
    };
}

/**
 * Display the KPI analysis results
 */
function displayKPIAnalysis(analysis, container) {
    const { userStats, kpiRecommendations, teamStats, startDate, endDate } = analysis;

    const html = `
        <div class="space-y-4">
            <!-- Team Overview -->
            <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <h5 class="text-sm font-bold text-indigo-300 mb-3">Team Performance Overview (${startDate} to ${endDate})</h5>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div class="bg-gray-900/50 p-2 rounded border-l-2 border-indigo-500">
                        <p class="text-gray-400">Team Average (Weekly)</p>
                        <p class="text-lg font-bold text-indigo-400">${Math.round(teamStats.average)}</p>
                        <p class="text-[10px] text-gray-500 mt-1">Baseline for all KPIs</p>
                    </div>
                    <div class="bg-gray-900/50 p-2 rounded">
                        <p class="text-gray-400">Team Median</p>
                        <p class="text-lg font-bold text-white">${Math.round(teamStats.median)}</p>
                        <p class="text-[10px] ${Math.abs(teamStats.average - teamStats.median) < 5 ? 'text-green-400' : 'text-yellow-400'} mt-1">
                            ${Math.abs(teamStats.average - teamStats.median) < 5
                                ? '✓ Close to average (balanced)'
                                : teamStats.median < teamStats.average
                                    ? '⚠ Below avg (few high performers)'
                                    : '⚠ Above avg (few low performers)'}
                        </p>
                    </div>
                    <div class="bg-gray-900/50 p-2 rounded">
                        <p class="text-gray-400">Standard Deviation</p>
                        <p class="text-lg font-bold text-yellow-400">${Math.round(teamStats.stdDev)}</p>
                        <p class="text-[10px] ${teamStats.stdDev < 15 ? 'text-green-400' : teamStats.stdDev < 30 ? 'text-yellow-400' : 'text-orange-400'} mt-1">
                            ${teamStats.stdDev < 15
                                ? '✓ Low - Very consistent team'
                                : teamStats.stdDev < 30
                                    ? '~ Moderate - Some variation'
                                    : '⚠ High - Wide performance gap'}
                        </p>
                    </div>
                    <div class="bg-gray-900/50 p-2 rounded">
                        <p class="text-gray-400">Total Team Members</p>
                        <p class="text-lg font-bold text-green-400">${teamStats.totalUsers}</p>
                        <p class="text-[10px] text-gray-500 mt-1">Analyzed users</p>
                    </div>
                </div>

                <!-- Statistics Explanation -->
                <div class="mt-3 p-2 bg-indigo-900/10 rounded border border-indigo-600/20">
                    <p class="text-[11px] text-gray-400">
                        <span class="font-semibold text-indigo-300">📊 What do these mean?</span><br/>
                        <span class="text-indigo-400">• Team Average:</span> Sum of all weekly scores ÷ number of users. This is the baseline everyone is compared to.<br/>
                        <span class="text-indigo-400">• Team Median:</span> The middle score when sorted. Half the team is above this, half below. Less affected by outliers than average.<br/>
                        <span class="text-indigo-400">• Standard Deviation:</span> Shows how spread out scores are. Higher = more variation in performance.
                    </p>
                </div>
            </div>

            <!-- Individual KPI Recommendations -->
            <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <h5 class="text-sm font-bold text-indigo-300 mb-3">Individual KPI Recommendations</h5>
                <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                        <thead class="bg-gray-900/50">
                            <tr>
                                <th class="text-left p-2 text-gray-400">User</th>
                                <th class="text-center p-2 text-gray-400">Tier</th>
                                <th class="text-center p-2 text-gray-400">Current Avg</th>
                                <th class="text-center p-2 text-gray-400">% of Team Avg</th>
                                <th class="text-center p-2 text-gray-400">Bonus %</th>
                                <th class="text-center p-2 text-gray-400">Total Score</th>
                                <th class="text-center p-2 text-gray-400">Current KPI<br/><span class="text-[10px] font-normal">(out of 5)</span></th>
                                <th class="text-left p-2 text-gray-400">Reasoning</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-700/50">
                            ${kpiRecommendations.map(rec => `
                                <tr class="hover:bg-gray-700/30">
                                    <td class="p-2 font-medium text-white">${rec.username}</td>
                                    <td class="p-2 text-center">
                                        <span class="px-2 py-1 rounded text-[10px] font-semibold ${getTierColor(rec.tier)}">
                                            ${rec.tier}
                                        </span>
                                    </td>
                                    <td class="p-2 text-center text-gray-300">${Math.round(rec.averageWeekly)}</td>
                                    <td class="p-2 text-center">
                                        <span class="font-semibold ${rec.percentOfTeamAvg < 90 ? 'text-orange-400' : rec.percentOfTeamAvg > 110 ? 'text-green-400' : 'text-gray-300'}">${rec.percentOfTeamAvg}%</span>
                                    </td>
                                    <td class="p-2 text-center">
                                        <span class="${rec.bonusPercentage > 0 ? 'text-yellow-400 font-bold text-sm' : 'text-gray-500'}">${rec.bonusPercentage > 0 ? '+' + rec.bonusPercentage + '%' : '0%'}</span>
                                    </td>
                                    <td class="p-2 text-center">
                                        <span class="text-indigo-400 font-bold text-sm">${rec.targetKPI}</span>
                                        <span class="text-gray-500 text-[10px] block">(${rec.currentVsTarget > 0 ? '+' : ''}${rec.currentVsTarget} pts)</span>
                                    </td>
                                    <td class="p-2 text-center">
                                        <span class="text-lg font-bold ${rec.kpiOutOf5 >= 4 ? 'text-green-400' : rec.kpiOutOf5 >= 3 ? 'text-blue-400' : rec.kpiOutOf5 >= 2 ? 'text-yellow-400' : 'text-orange-400'}">${rec.kpiOutOf5}/5</span>
                                    </td>
                                    <td class="p-2 text-gray-400 text-[10px]">${rec.reasoning}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Fairness Explanation -->
            <div class="bg-indigo-900/20 border border-indigo-600/30 rounded-lg p-3">
                <h6 class="text-xs font-bold text-indigo-300 mb-2">📋 KPI Setting Methodology (Bonus-Only System)</h6>
                <div class="text-[11px] text-gray-400 space-y-1">
                    <p><span class="text-red-400 font-semibold">Needs Support (&lt;70% of team avg):</span> Current + 25% bonus. Extra support to help catch up.</p>
                    <p><span class="text-orange-400 font-semibold">Developing (70-90% of team avg):</span> Current + 15% bonus. Moderate support to reach team level.</p>
                    <p><span class="text-yellow-400 font-semibold">Proficient (90-110% of team avg):</span> Current level maintained. No bonus needed.</p>
                    <p><span class="text-green-400 font-semibold">Advanced (110-125% of team avg):</span> Current level maintained. Already performing well.</p>
                    <p><span class="text-blue-400 font-semibold">Expert (≥125% of team avg):</span> Current level maintained. Already excellent.</p>
                </div>
                <div class="mt-3 p-2 bg-yellow-900/20 rounded border border-yellow-600/30">
                    <p class="text-[10px] text-yellow-300">
                        <span class="font-semibold">💡 Why bonuses only for lower performers?</span><br/>
                        This system focuses on <span class="font-semibold">helping those who need it most</span>. Lower performers get bonus percentages to make their targets achievable, while average and above-average performers maintain their current level. This creates a fairer system that supports growth where needed.
                    </p>
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

/**
 * Get color class for tier badge
 */
function getTierColor(tier) {
    switch(tier) {
        case 'Needs Support': return 'bg-red-500/20 text-red-400 border border-red-500/40';
        case 'Developing': return 'bg-orange-500/20 text-orange-400 border border-orange-500/40';
        case 'Proficient': return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40';
        case 'Advanced': return 'bg-green-500/20 text-green-400 border border-green-500/40';
        case 'Expert': return 'bg-blue-500/20 text-blue-400 border border-blue-500/40';
        default: return 'bg-gray-500/20 text-gray-400 border border-gray-500/40';
    }
}

/**
 * Export KPI analysis to Excel
 */
export async function exportKPIAnalysis() {
    if (!window.currentKPIAnalysis) {
        alert('Please generate an analysis first.');
        return;
    }

    const { kpiRecommendations, teamStats, startDate, endDate } = window.currentKPIAnalysis;

    // Prepare data for export
    const exportData = [];

    // Add summary rows
    exportData.push(['KPI ANALYSIS REPORT']);
    exportData.push(['Period', `${startDate} to ${endDate}`]);
    exportData.push([]);
    exportData.push(['TEAM STATISTICS']);
    exportData.push(['Team Average', Math.round(teamStats.average)]);
    exportData.push(['Team Median', Math.round(teamStats.median)]);
    exportData.push(['Total Users', teamStats.totalUsers]);
    exportData.push([]);
    exportData.push(['INDIVIDUAL KPI RECOMMENDATIONS']);
    exportData.push(['User', 'Performance Tier', 'Current Weekly Avg', '% of Team Avg', 'Bonus %', 'Total Score', 'Current KPI (out of 5)', 'Points to Grow', 'Reasoning']);

    // Add user data
    kpiRecommendations.forEach(rec => {
        exportData.push([
            rec.username,
            rec.tier,
            Math.round(rec.averageWeekly),
            `${rec.percentOfTeamAvg}%`,
            rec.bonusPercentage > 0 ? `+${rec.bonusPercentage}%` : '0%',
            rec.targetKPI,
            `${rec.kpiOutOf5}/5`,
            rec.currentVsTarget,
            rec.reasoning
        ]);
    });

    // Convert to CSV
    const csv = exportData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KPI_Analysis_${startDate}_to_${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Utility functions

function calculateMedian(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function calculatePercentile(arr, percentile) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function calculateStdDev(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
    const squaredDiffs = arr.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / arr.length;
    return Math.sqrt(avgSquaredDiff);
}

/**
 * Generate KPI analysis for current user only
 */
export async function generateUserKPIAnalysis(userId, username, startDate, endDate) {
    try {
        // Fetch weekly scores for the period (for all users to calculate team average)
        const { data: weeklyScores, error } = await _supabase
            .from('weekly_leaderboard')
            .select('*')
            .gte('week_start_date', startDate)
            .lte('week_start_date', endDate)
            .order('week_start_date', { ascending: true });

        if (error) throw error;

        if (!weeklyScores || weeklyScores.length === 0) {
            return { error: 'No data found for the selected period.' };
        }

        // Process all data to get team stats
        const analysis = analyzePerformanceData(weeklyScores, startDate, endDate);

        // Filter to only current user's recommendation
        const userRecommendation = analysis.kpiRecommendations.find(rec => rec.username === username);

        if (!userRecommendation) {
            return { error: 'No data found for your account in this period.' };
        }

        return {
            userRecommendation,
            teamStats: analysis.teamStats,
            startDate,
            endDate
        };

    } catch (error) {
        console.error('Error generating user KPI analysis:', error);
        return { error: error.message };
    }
}

// Functions will be exported via main.js to avoid overwriting issues
