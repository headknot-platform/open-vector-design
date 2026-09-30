import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';
import { AssetsPanel } from './AssetsPanel';
import { LayersPanel } from './LayersPanel';
import { TokensPanel } from './TokensPanel';

export function LeftPanel() {
    return (
        <Tabs defaultValue="layers" className="flex h-full flex-col gap-0">
            <TabsList className="m-2 mb-0 grid h-8 grid-cols-3">
                <TabsTrigger value="layers" className="text-xs">
                    Layers
                </TabsTrigger>
                <TabsTrigger value="assets" className="text-xs">
                    Assets
                </TabsTrigger>
                <TabsTrigger value="tokens" className="text-xs">
                    Tokens
                </TabsTrigger>
            </TabsList>
            <TabsContent value="layers" className="min-h-0 flex-1">
                <LayersPanel />
            </TabsContent>
            <TabsContent value="assets" className="min-h-0 flex-1">
                <AssetsPanel />
            </TabsContent>
            <TabsContent value="tokens" className="min-h-0 flex-1">
                <TokensPanel />
            </TabsContent>
        </Tabs>
    );
}
