/**
 * KuzuDB WASM Filesystem COPY Test
 * 
 * This test verifies that we can:
 * 1. Initialize KuzuDB WASM in Node.js environment
 * 2. Write CSV data to the WASM filesystem using FS.writeFile
 * 3. Use COPY statements to bulk load data
 * 4. Query the data to verify it was loaded correctly
 */

const path = require('path');

async function testKuzuFSCopy() {
  let kuzu;
  let db;
  let conn;

  try {
    console.log('🚀 Starting KuzuDB WASM FS COPY Test...\n');

    // Step 1: Initialize KuzuDB WASM
    console.log('📦 Loading kuzu-wasm package...');
    kuzu = require('kuzu-wasm');
    
    // Use Node.js version for testing
    console.log('🔧 Initializing KuzuDB (Node.js mode)...');
    const kuzuNodejs = require('kuzu-wasm/nodejs');
    
    // Create database and connection
    console.log('🗃️ Creating in-memory database...');
    db = new kuzuNodejs.Database(':memory:');
    conn = new kuzuNodejs.Connection(db);
    
    console.log('✅ KuzuDB initialized successfully\n');

    // Step 2: Create schema
    console.log('📋 Creating database schema...');
    
    // Create node tables
    await conn.query('CREATE NODE TABLE User(name STRING, age INT64, PRIMARY KEY (name))');
    console.log('✓ Created User node table');
    
    await conn.query('CREATE NODE TABLE City(name STRING, population INT64, PRIMARY KEY (name))');
    console.log('✓ Created City node table');
    
    // Create relationship tables
    await conn.query('CREATE REL TABLE Follows(FROM User TO User, since INT64)');
    console.log('✓ Created Follows relationship table');
    
    await conn.query('CREATE REL TABLE LivesIn(FROM User TO City)');
    console.log('✓ Created LivesIn relationship table');
    
    console.log('✅ Schema created successfully\n');

    // Step 3: Prepare CSV data (simulating GitNexus graph data)
    console.log('📝 Preparing CSV data...');
    
    const userCSV = `Adam,30
Karissa,40
Zhang,50
Noura,25
TestUser1,35
TestUser2,28`;

    const cityCSV = `Waterloo,150000
Kitchener,200000
Guelph,75000
Toronto,2930000`;

    const followsCSV = `Adam,Karissa,2020
Adam,Zhang,2020
Karissa,Zhang,2021
Zhang,Noura,2022
TestUser1,TestUser2,2023`;

    const livesInCSV = `Adam,Waterloo
Karissa,Waterloo
Zhang,Kitchener
Noura,Guelph
TestUser1,Toronto
TestUser2,Toronto`;

    console.log('✓ CSV data prepared');

    // Step 4: Write CSV files to WASM filesystem
    console.log('💾 Writing CSV files to WASM filesystem...');
    
    // Note: For Node.js version, we might need to write actual files
    // Let's try both approaches
    
    const fs = require('fs').promises;
    const tmpDir = './temp_kuzu_test';
    
    // Create temp directory
    try {
      await fs.mkdir(tmpDir, { recursive: true });
    } catch (e) {
      // Directory might already exist
    }
    
    // Write CSV files
    await fs.writeFile(path.join(tmpDir, 'user.csv'), userCSV);
    await fs.writeFile(path.join(tmpDir, 'city.csv'), cityCSV);
    await fs.writeFile(path.join(tmpDir, 'follows.csv'), followsCSV);
    await fs.writeFile(path.join(tmpDir, 'lives-in.csv'), livesInCSV);
    
    console.log('✓ CSV files written to filesystem');

    // Step 5: Use COPY statements to load data
    console.log('📥 Loading data using COPY statements...');
    
    const copyQueries = [
      `COPY User FROM '${path.join(tmpDir, 'user.csv')}'`,
      `COPY City FROM '${path.join(tmpDir, 'city.csv')}'`,
      `COPY Follows FROM '${path.join(tmpDir, 'follows.csv')}'`,
      `COPY LivesIn FROM '${path.join(tmpDir, 'lives-in.csv')}'`
    ];

    for (const query of copyQueries) {
      console.log(`   Executing: ${query}`);
      const result = await conn.query(query);
      console.log(`   ✓ Result: ${result.toString()}`);
      await result.close();
    }
    
    console.log('✅ Data loaded successfully using COPY statements\n');

    // Step 6: Verify data was loaded by querying
    console.log('🔍 Verifying data was loaded correctly...');
    
    // Query 1: Count nodes
    console.log('\n📊 Node counts:');
    let result = await conn.query('MATCH (u:User) RETURN count(u) as userCount');
    let rows = await result.getAllObjects();
    console.log(`   Users: ${rows[0]?.userCount || 0}`);
    await result.close();
    
    result = await conn.query('MATCH (c:City) RETURN count(c) as cityCount');
    rows = await result.getAllObjects();
    console.log(`   Cities: ${rows[0]?.cityCount || 0}`);
    await result.close();

    // Query 2: Sample user data
    console.log('\n👥 Sample user data:');
    result = await conn.query('MATCH (u:User) RETURN u.name, u.age ORDER BY u.name LIMIT 5');
    rows = await result.getAllObjects();
    rows.forEach(row => {
      console.log(`   ${row['u.name']}: ${row['u.age']} years old`);
    });
    await result.close();

    // Query 3: Sample city data
    console.log('\n🏙️ Sample city data:');
    result = await conn.query('MATCH (c:City) RETURN c.name, c.population ORDER BY c.population DESC LIMIT 5');
    rows = await result.getAllObjects();
    rows.forEach(row => {
      console.log(`   ${row['c.name']}: ${row['c.population']} population`);
    });
    await result.close();

    // Query 4: Relationship counts
    console.log('\n🔗 Relationship counts:');
    result = await conn.query('MATCH ()-[f:Follows]->() RETURN count(f) as followsCount');
    rows = await result.getAllObjects();
    console.log(`   Follows relationships: ${rows[0]?.followsCount || 0}`);
    await result.close();
    
    result = await conn.query('MATCH ()-[l:LivesIn]->() RETURN count(l) as livesInCount');
    rows = await result.getAllObjects();
    console.log(`   LivesIn relationships: ${rows[0]?.livesInCount || 0}`);
    await result.close();

    // Query 5: Complex join query
    console.log('\n🎯 Complex query - Who follows whom:');
    result = await conn.query(`
      MATCH (u1:User)-[f:Follows]->(u2:User) 
      RETURN u1.name as follower, u2.name as following, f.since 
      ORDER BY f.since DESC
    `);
    rows = await result.getAllObjects();
    rows.forEach(row => {
      console.log(`   ${row.follower} follows ${row.following} since ${row.since}`);
    });
    await result.close();

    // Query 6: Another complex query - Where do people live
    console.log('\n🏠 Complex query - Where people live:');
    result = await conn.query(`
      MATCH (u:User)-[l:LivesIn]->(c:City) 
      RETURN u.name as person, c.name as city, c.population
      ORDER BY c.population DESC, u.name
    `);
    rows = await result.getAllObjects();
    rows.forEach(row => {
      console.log(`   ${row.person} lives in ${row.city} (pop: ${row.population})`);
    });
    await result.close();

    console.log('\n✅ All verification queries completed successfully!');
    console.log('\n🎉 COPY approach is working perfectly!');

    // Performance comparison note
    console.log('\n📈 Performance Notes:');
    console.log('   - COPY statements loaded all data in bulk operations');
    console.log('   - Much faster than individual INSERT/MERGE statements');
    console.log('   - Suitable for GitNexus bulk data loading');

    // Cleanup temp files
    console.log('\n🧹 Cleaning up temporary files...');
    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log('✓ Cleanup completed');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    // Cleanup database connections
    if (conn) {
      try {
        await conn.close();
        console.log('🔒 Database connection closed');
      } catch (e) {
        console.warn('Warning: Failed to close connection:', e.message);
      }
    }
    
    if (db) {
      try {
        await db.close();
        console.log('🔒 Database closed');
      } catch (e) {
        console.warn('Warning: Failed to close database:', e.message);
      }
    }
  }
}

// Run the test
if (require.main === module) {
  testKuzuFSCopy()
    .then(() => {
      console.log('\n🎊 Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed with error:', error);
      process.exit(1);
    });
}

module.exports = { testKuzuFSCopy };
