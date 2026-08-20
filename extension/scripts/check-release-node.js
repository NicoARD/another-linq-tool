const [major] = process.versions.node.split('.').map(Number);

if (major < 20) {
    console.error(`Packaging Another LINQ Tool requires Node.js 20 or newer; found ${process.version}.`);
    process.exit(1);
}
