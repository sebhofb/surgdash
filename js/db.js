window.DB = {
    dbName: 'SURGhub_Analytics',
    dbVersion: 1,
    db: null,

    init: function() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject("Could not open local IndexedDB instance.");
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('courses')) {
                    const courseStore = db.createObjectStore('courses', { keyPath: 'CourseID' });
                    courseStore.createIndex('Provider', 'Provider', { unique: false });
                }

                if (!db.objectStoreNames.contains('learners')) {
                    const learnerStore = db.createObjectStore('learners', { keyPath: 'UserID' });
                    learnerStore.createIndex('Country', 'Country', { unique: false });
                    learnerStore.createIndex('Profession', 'Profession', { unique: false });
                }

                if (!db.objectStoreNames.contains('enrollments')) {
                    const enrollmentStore = db.createObjectStore('enrollments', { keyPath: 'id', autoIncrement: true });
                    enrollmentStore.createIndex('UserID', 'UserID', { unique: false });
                    enrollmentStore.createIndex('CourseID', 'CourseID', { unique: false });
                    enrollmentStore.createIndex('StartDate', 'StartDate', { unique: false });
                    enrollmentStore.createIndex('CertificateDate', 'CertificateDate', { unique: false });
                    enrollmentStore.createIndex('User_Course', ['UserID', 'CourseID'], { unique: true });
                }
            };
        });
    },

    bulkPut: function(storeName, dataArray) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized");
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            dataArray.forEach(item => store.put(item));

            transaction.oncomplete = () => resolve(`${dataArray.length} records saved to ${storeName}`);
            transaction.onerror = (event) => reject(event.target.error);
        });
    },

    getAll: function(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized");

            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    },

    getEnrollmentsByCourse: function(courseId) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized");

            const transaction = this.db.transaction(['enrollments'], 'readonly');
            const store = transaction.objectStore('enrollments');
            const index = store.index('CourseID');
            const request = index.getAll(courseId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    },

    clearStore: function(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized");

            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve(`${storeName} cleared`);
            request.onerror = (event) => reject(event.target.error);
        });
    }
};