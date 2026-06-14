window.Pipeline = {
    normalizeString: (str) => {
        if (!str) return '';
        return String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    },

    cleanNum: function(val) {
        if (val === undefined || val === null || val === '') return 0;
        const cleaned = String(val).replace(/[^0-9.-]+/g, "");
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
    },

    parseDateToExact: function(val) {
        if (!val) return '2023-01-01';
        let str = String(val).trim();
        const mmmMatch = str.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
        if (mmmMatch) {
            const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
            const d = mmmMatch[1].padStart(2, '0');
            const m = months[mmmMatch[2].toLowerCase().substring(0, 3)] || '01';
            return `${mmmMatch[3]}-${m}-${d}`;
        }
        let d = new Date(str);
        return isNaN(d.getTime()) ? '2023-01-01' : d.toISOString().split('T')[0];
    },

    parseDateToMonth: function(val) {
        return this.parseDateToExact(val).substring(0, 7);
    },

    readExcel: function(file) {
        return new Promise((resolve, reject) => {
            if (file.name.toLowerCase().endsWith('.csv') && window.Papa) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    Papa.parse(e.target.result, {
                        header: true, skipEmptyLines: true,
                        complete: (res) => resolve(res.data),
                        error: (err) => reject(new Error("CSV Error: " + err.message))
                    });
                };
                reader.readAsText(file);
            } else {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const wb = XLSX.read(data, { type: 'array' });
                        resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }));
                    } catch(err) { reject(new Error("Excel Parsing Error")); }
                };
                reader.readAsArrayBuffer(file);
            }
        });
    },

    readAllSheets: function(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    const res = {};
                    wb.SheetNames.forEach(n => res[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" }));
                    resolve(res);
                } catch(err) { reject(new Error("Excel Parsing Error")); }
            };
            reader.readAsArrayBuffer(file);
        });
    },

    processMasterUpload: async function(file) {
        const json = await this.readExcel(file);
        return json.map(row => ({
            Course: row["Course title"] || row["Course Title"] || Object.values(row)[0],
            Learners: this.cleanNum(row["Learners"] || row["Enrollments"]),
            Certificates: this.cleanNum(row["Certificates Issued"] || row["Certificates"])
        })).filter(r => r.Course && r.Course !== "Course title");
    }
};