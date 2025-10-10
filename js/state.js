// js/state.js
// This file holds the single source of truth for the application's shared state.

export let appState = {
    currentUser: null,
    currentShiftId: null,
    selectedSource: null,
    tickets: [],
    doneTickets: [],
    followUpTickets: [],
    allUsers: new Map(),
    userEmailMap: new Map(),
    attendance: new Map(),
    currentPage: 0,
    doneCurrentPage: 0,
    TICKETS_PER_PAGE: 20,
    currentView: 'tickets',
    charts: {},
    MAX_NOTE_LENGTH: 3000,
    deploymentNotes: [],
    currentUserRole: null,
    lastScheduleUpdate: null,
    expandedTicketId: null, // To track which ticket to auto-expand
};

