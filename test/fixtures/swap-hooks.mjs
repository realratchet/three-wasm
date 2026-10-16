// Node module hooks: resolve three's src math modules to the replacements, the
// same substitution a bundler alias performs. THREE_WASM_SWAP selects which
// (comma-separated class names; default all).
const REPLACEMENTS = {
    Matrix4: new URL("../../src/Matrix4.js", import.meta.url).href,
    Euler: new URL("../../src/Euler.js", import.meta.url).href
};

const enabled = new Set((process.env.THREE_WASM_SWAP ?? Object.keys(REPLACEMENTS).join(",")).split(",").filter(Boolean));

export async function resolve(specifier, context, next) {

    const result = await next(specifier, context);
    const match = /\/three\/src\/math\/(\w+)\.js$/.exec(result.url);
    if (match && enabled.has(match[1]) && REPLACEMENTS[match[1]]) return { ...result, url: REPLACEMENTS[match[1]] };
    return result;
}
