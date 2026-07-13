module.exports = {
	apps: [{
		name: 'tracker-server',
		script: 'dist/main.js',
		instances: 2,
		exec_mode: 'cluster',
		max_memory_restart: '500M',
		max_restarts: 50,
		restart_delay: 1000,
		env: {
			NODE_ENV: 'production',
		},
	}],
};
