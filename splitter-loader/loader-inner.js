import { processContent, getSplitterLoader } from './splitter-utils.js';

export default async function asyncLoader(content, map, meta) {
    const {
        context
    } = this.getOptions();

    const loader = this;

    if (await getSplitterLoader(loader, context) == null)
        return content;

    const processedContent = await processContent(content, context, loader);

    console.log('In inner splitter loader, exported with context ' + context);
    console.log(processedContent);

    return processedContent;
}