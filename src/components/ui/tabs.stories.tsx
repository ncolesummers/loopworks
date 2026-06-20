import type { Meta, StoryObj } from "@storybook/nextjs";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const meta = {
  title: "UI/Primitives/Tabs",
  component: Tabs,
  render: () => (
    <Tabs defaultValue="overview" className="w-[520px]">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="runs">Runs</TabsTrigger>
        <TabsTrigger value="governance">Governance</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <Card>
          <CardContent className="pt-6 text-sm">Overview content.</CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="runs">
        <Card>
          <CardContent className="pt-6 text-sm">Run history content.</CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="governance">
        <Card>
          <CardContent className="pt-6 text-sm">Governance content.</CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  ),
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
